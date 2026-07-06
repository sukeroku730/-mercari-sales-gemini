import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

function extractJson(text: string) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('JSONが見つかりませんでした: ' + cleaned.slice(0, 1000))
  return JSON.parse(cleaned.slice(start, end + 1))
}

function normalized(parsed: any) {
  return {
    ok: true,
    series: String(parsed.series || ''),
    character: String(parsed.character || ''),
    item: String(parsed.item || ''),
    price: String(parsed.price || '').replace(/[^0-9]/g, ''),
    shipping: String(parsed.shipping || '160').replace(/[^0-9]/g, '') || '160'
  }
}

async function analyzeWithModel(apiKey: string, model: string, base64: string, mimeType: string) {
  const prompt = `あなたはメルカリ売上管理アプリ用のOCRです。画像はメルカリの売れた商品画面です。必ずJSONだけを返してください。\n{"series":"作品名。例: 呪術廻戦。分からなければ空文字","character":"キャラ名。例: 伏黒恵。分からなければ空文字","item":"商品種別。例: アクリルスタンド、缶バッジ、カード。分からなければ空文字","price":"販売価格の数字のみ。例: 3333。分からなければ空文字","shipping":"送料の数字のみ。ゆうパケットポストminiなら160。分からなければ160"}\n商品タイトルと価格を優先してください。`
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [ { text: prompt }, { inlineData: { mimeType, data: base64 } } ] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    })
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${raw.slice(0, 2000)}`)
  const data = JSON.parse(raw)
  const text = data?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text || '').join('\n') || ''
  if (!text) throw new Error(`${model}: テキスト返答が空です raw=${raw.slice(0, 1000)}`)
  return normalized(extractJson(text))
}

export async function POST(req: NextRequest) {
  const debug: string[] = []
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ ok:false, error:'GEMINI_API_KEY が未設定です。', detail:'Vercel > Environment Variables を確認してください。' }, { status: 200 })
    debug.push(`apiKey=set ${apiKey.slice(0,4)}...${apiKey.slice(-4)}`)

    const form = await req.formData()
    const file = form.get('image') as any
    if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ ok:false, error:'画像ファイルがありません。', detail: debug.join('\n') }, { status: 200 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = file.type || 'image/jpeg'
    debug.push(`file=${file.name || 'unknown'} type=${mimeType} size=${buffer.length}`)

    const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest']
    const errors: string[] = []
    for (const model of models) {
      try {
        debug.push(`try ${model}`)
        const result = await analyzeWithModel(apiKey, model, buffer.toString('base64'), mimeType)
        return NextResponse.json({ ...result, detail: debug.join('\n') }, { status: 200 })
      } catch (e:any) {
        errors.push(e?.message || String(e))
        debug.push(`failed ${model}: ${(e?.message || String(e)).slice(0,600)}`)
      }
    }
    return NextResponse.json({ ok:false, error:'Gemini APIの読み取りに失敗しました。', detail: debug.join('\n') + '\n\n--- errors ---\n' + errors.join('\n---\n') }, { status: 200 })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:'画像読み取り処理でエラーが出ました。', detail: debug.join('\n') + '\n' + (e?.stack || e?.message || String(e)) }, { status: 200 })
  }
}

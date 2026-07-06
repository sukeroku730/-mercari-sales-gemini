import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Result = {
  series?: string
  character?: string
  item?: string
  price?: string
  shipping?: string
}

function extractJson(text: string): Result {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return {}
  try { return JSON.parse(match[0]) } catch { return {} }
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ ok:false, error:'GEMINI_API_KEY が未設定です。VercelのEnvironment Variablesに追加してください。' }, { status: 500 })
    }

    const form = await req.formData()
    const file = form.get('image')
    if (!(file instanceof File)) {
      return NextResponse.json({ ok:false, error:'画像ファイルが送信されていません。' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const base64 = bytes.toString('base64')
    const mimeType = file.type || 'image/jpeg'

    const prompt = `あなたはメルカリ売上管理アプリの画像読み取り担当です。\n売れた商品のスクリーンショットから次を抽出してください。\n必ずJSONだけで返してください。\n\n{\n  "series": "作品名。例: 呪術廻戦",\n  "character": "キャラ名。分からなければ空文字",\n  "item": "商品名。例: アクリルスタンド",\n  "price": "販売価格の数字だけ。例: 3333",\n  "shipping": "送料の数字だけ。ゆうパケットポストminiなら160。分からなければ160"\n}\n\n注意:\n- 価格は「¥3,333」なら3333にする。\n- 手数料や利益は計算しない。\n- 分からない項目は空文字にする。`

    const models = ['gemini-2.0-flash','gemini-1.5-flash','gemini-2.5-flash']
    let lastError = ''

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const body = {
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
          responseMimeType: 'application/json'
        }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const raw = await res.text()
      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status} ${raw.slice(0, 700)}`
        continue
      }

      let json: any
      try { json = JSON.parse(raw) } catch {
        lastError = `${model}: Geminiの返答がJSONではありません: ${raw.slice(0, 700)}`
        continue
      }
      const text = json?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join('\n') || ''
      const result = extractJson(text)
      return NextResponse.json({
        ok: true,
        series: result.series || '',
        character: result.character || '',
        item: result.item || '',
        price: String(result.price || '').replace(/[^0-9]/g,''),
        shipping: String(result.shipping || '160').replace(/[^0-9]/g,'') || '160',
        debug: `model=${model}`
      })
    }

    return NextResponse.json({ ok:false, error:'Gemini APIの読み取りに失敗しました。', detail:lastError }, { status: 500 })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:'サーバー側でエラーが発生しました。', detail:String(e?.message || e) }, { status: 500 })
  }
}

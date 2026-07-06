import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

function extractJson(text: string) {
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) {
    throw new Error('JSONが見つかりませんでした。Gemini返答: ' + cleaned.slice(0, 600))
  }
  return JSON.parse(cleaned.slice(start, end + 1))
}

function normalize(parsed: any) {
  return {
    series: String(parsed.series || ''),
    character: String(parsed.character || ''),
    item: String(parsed.item || ''),
    price: String(parsed.price || '').replace(/[^0-9]/g, ''),
    shipping: String(parsed.shipping || '160').replace(/[^0-9]/g, '') || '160'
  }
}

async function callGemini(apiKey: string, model: string, prompt: string, base64: string, mimeType: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
    })
  })

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`${model} / HTTP ${res.status}: ${raw.slice(0, 900)}`)
  }
  let data: any
  try { data = JSON.parse(raw) } catch { throw new Error(`${model}: Geminiの返答がJSONではありません: ${raw.slice(0, 900)}`) }
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('\n') || ''
  if (!text) throw new Error(`${model}: テキスト返答が空です。raw=${raw.slice(0, 900)}`)
  return normalize(extractJson(text))
}

export async function POST(req: NextRequest) {
  const debug: string[] = []
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY が未設定です。VercelのEnvironment Variablesに追加してください。' }, { status: 400 })
    }
    debug.push(`GEMINI_API_KEY: set (${apiKey.slice(0, 4)}...${apiKey.slice(-4)})`)

    const form = await req.formData()
    const file = form.get('image')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '画像ファイルがありません。' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    debug.push(`file: ${file.name || 'unknown'}, type=${file.type || 'unknown'}, size=${buffer.length}`)
    if (buffer.length > 18 * 1024 * 1024) {
      return NextResponse.json({ error: '画像が大きすぎます。スクショを少し小さくして再度試してください。', detail: debug.join('\n') }, { status: 400 })
    }

    const prompt = `メルカリの売れた商品画面のスクリーンショットから情報を読み取ってください。必ずJSONだけを返してください。\n{\n  "series": "作品名。例: 呪術廻戦。分からなければ空文字",\n  "character": "キャラ名。例: 伏黒恵。分からなければ空文字",\n  "item": "商品種別。例: アクリルスタンド、缶バッジ、カード。分からなければ空文字",\n  "price": "販売価格の数字のみ。例: 3333。分からなければ空文字",\n  "shipping": "送料の数字のみ。ゆうパケットポストminiなら160。分からなければ160"\n}\n注意: 価格は「¥3,333」なら「3333」。商品タイトルを優先。推測しすぎない。`

    const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview']
    const errors: string[] = []
    for (const model of models) {
      try {
        debug.push(`trying ${model}`)
        const result = await callGemini(apiKey, model, prompt, buffer.toString('base64'), file.type || 'image/png')
        return NextResponse.json({ ...result, debug: debug.join('\n') })
      } catch (e: any) {
        const msg = e?.message || String(e)
        debug.push(`failed ${model}: ${msg.slice(0, 300)}`)
        errors.push(msg)
      }
    }

    return NextResponse.json({
      error: 'Gemini APIの読み取りに失敗しました。下の詳細をスクショで送ってください。',
      detail: debug.join('\n') + '\n\n--- errors ---\n' + errors.join('\n---\n')
    }, { status: 500 })
  } catch (e: any) {
    return NextResponse.json({
      error: '画像読み取り処理でエラーが出ました。',
      detail: debug.join('\n') + '\n' + (e?.stack || e?.message || String(e))
    }, { status: 500 })
  }
}

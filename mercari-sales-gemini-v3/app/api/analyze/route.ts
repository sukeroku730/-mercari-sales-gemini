import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

function extractJson(text: string) {
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Geminiの返答からJSONを見つけられませんでした: ' + cleaned.slice(0, 200))
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

async function callGenerateContent(apiKey: string, model: string, prompt: string, base64: string, mimeType: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
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
    })
  })

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`${model}: ${raw.slice(0, 500)}`)
  }
  const data = JSON.parse(raw)
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('\n') || ''
  if (!text) throw new Error(`${model}: Geminiから文字が返りませんでした`)
  return normalize(extractJson(text))
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY が未設定です。VercelのEnvironment Variablesに追加してください。' }, { status: 400 })
    }

    const form = await req.formData()
    const file = form.get('image')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '画像ファイルがありません。' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > 18 * 1024 * 1024) {
      return NextResponse.json({ error: '画像が大きすぎます。スクショを少し小さくして再度試してください。' }, { status: 400 })
    }
    const base64 = buffer.toString('base64')
    const mimeType = file.type || 'image/png'

    const prompt = `あなたはメルカリの売れた商品画面を読み取るアシスタントです。\n画像から分かる範囲で、次のJSONだけを返してください。\n\n{\n  "series": "作品名。例: 呪術廻戦。分からなければ空文字",\n  "character": "キャラ名。例: 伏黒恵。分からなければ空文字",\n  "item": "商品名。例: アクリルスタンド、缶バッジ、カードなど。分からなければ空文字",\n  "price": "販売価格の数字のみ。例: 3333。分からなければ空文字",\n  "shipping": "送料の数字のみ。画像に送料があればそれ、なければ160"\n}\n\n注意:\n- 日本語の商品タイトルを優先してください。\n- 価格は「¥3,333」なら「3333」です。\n- ゆうパケットポストminiの場合、送料は160です。\n- 推測しすぎず、分からない欄は空文字にしてください。`

    const models = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
    const errors: string[] = []
    for (const model of models) {
      try {
        const result = await callGenerateContent(apiKey, model, prompt, base64, mimeType)
        return NextResponse.json(result)
      } catch (e: any) {
        errors.push(e?.message || String(e))
      }
    }

    return NextResponse.json({
      error: 'Gemini APIの読み取りに失敗しました。APIキー、モデルの利用可否、または利用制限を確認してください。',
      detail: errors.join('\n---\n')
    }, { status: 500 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || '画像読み取りに失敗しました。' }, { status: 500 })
  }
}

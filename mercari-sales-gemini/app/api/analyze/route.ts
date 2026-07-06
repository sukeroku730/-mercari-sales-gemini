import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

function extractJson(text: string) {
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('JSONが見つかりませんでした')
  return JSON.parse(cleaned.slice(start, end + 1))
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
    const base64 = buffer.toString('base64')
    const mimeType = file.type || 'image/jpeg'

    const prompt = `あなたはメルカリの売れた商品画面を読み取るアシスタントです。
画像から分かる範囲で、次のJSONだけを返してください。説明文やコードブロックは不要です。

{
  "series": "作品名。例: 呪術廻戦。分からなければ空文字",
  "character": "キャラ名。例: 伏黒恵。分からなければ空文字",
  "item": "商品名。例: アクリルスタンド、缶バッジ、カードなど。分からなければ空文字",
  "price": "販売価格の数字のみ。例: 3333。分からなければ空文字",
  "shipping": "送料の数字のみ。画像に送料があればそれ、なければ160"
}

注意:
- 日本語の商品タイトルを優先してください。
- 価格は「¥3,333」なら「3333」です。
- ゆうパケットポストminiの場合、送料は160です。
- 推測しすぎず、分からない欄は空文字にしてください。`

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
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
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
      })
    })

    if (!res.ok) {
      const detail = await res.text()
      return NextResponse.json({ error: 'Gemini APIの読み取りに失敗しました。APIキーや利用制限を確認してください。', detail }, { status: 500 })
    }

    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text || '').join('\n') || ''
    const parsed = extractJson(text)

    return NextResponse.json({
      series: String(parsed.series || ''),
      character: String(parsed.character || ''),
      item: String(parsed.item || ''),
      price: String(parsed.price || '').replace(/[^0-9]/g, ''),
      shipping: String(parsed.shipping || '160').replace(/[^0-9]/g, '') || '160'
    })
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || '画像読み取りに失敗しました。' }, { status: 500 })
  }
}

'use client'
import { useEffect, useMemo, useState } from 'react'

type Sale = { id:string; date:string; series:string; character:string; item:string; price:number; fee:number; shipping:number; profit:number }
const yen = (n:number)=> new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n)
const today = ()=> new Date().toISOString().slice(0,10)

export default function Page(){
  const [sales,setSales]=useState<Sale[]>([])
  const [q,setQ]=useState('')
  const [loading,setLoading]=useState(false)
  const [message,setMessage]=useState('')
  const [debug,setDebug]=useState('')
  const [form,setForm]=useState({date:today(),series:'',character:'',item:'',price:'',shipping:'160'})
  useEffect(()=>{ try{ setSales(JSON.parse(localStorage.getItem('mercari-sales')||'[]')) }catch{} },[])
  useEffect(()=>{ localStorage.setItem('mercari-sales',JSON.stringify(sales)) },[sales])
  const filtered=sales.filter(s=>[s.series,s.character,s.item].join(' ').toLowerCase().includes(q.toLowerCase()))
  const total=filtered.reduce((a,s)=>a+s.profit,0)
  const bySeries=useMemo(()=>{
    const m=new Map<string,{count:number,profit:number,sales:number}>()
    for(const s of filtered){ const key=s.series||'未分類'; const v=m.get(key)||{count:0,profit:0,sales:0}; v.count++; v.profit+=s.profit; v.sales+=s.price; m.set(key,v) }
    return Array.from(m.entries()).sort((a,b)=>b[1].profit-a[1].profit)
  },[filtered])
  async function analyze(file: File){
    setLoading(true); setMessage('画像を読み取り中です…')
    try{
      const fd=new FormData(); fd.append('image',file)
      const res=await fetch('/api/analyze',{method:'POST',body:fd})
      const data=await res.json()
      setDebug(data.detail || data.debug || '')
      if(!res.ok) throw new Error(data.error || '読み取りに失敗しました')
      setForm(f=>({ ...f, series:data.series||f.series, character:data.character||f.character, item:data.item||f.item, price:data.price||f.price, shipping:data.shipping||f.shipping||'160' }))
      setMessage('読み取りました。内容を確認して「追加する」を押してください。')
    }catch(e:any){ setMessage(e.message || '読み取りに失敗しました') }
    finally{ setLoading(false) }
  }
  function add(){
    const price=Number(form.price), shipping=Number(form.shipping||160)
    if(!price || !form.series || !form.item){ alert('作品名・商品名・販売価格を入れてください'); return }
    const fee=Math.floor(price*0.1)
    const sale={id:crypto.randomUUID(),date:form.date,series:form.series,character:form.character,item:form.item,price,fee,shipping,profit:price-fee-shipping}
    setSales([sale,...sales]); setForm({...form,character:'',item:'',price:''}); setMessage('追加しました。')
  }
  function remove(id:string){ if(confirm('削除しますか？')) setSales(sales.filter(s=>s.id!==id)) }
  function csv(){
    const rows=[['日付','作品','キャラ','商品','販売価格','手数料','送料','利益'],...sales.map(s=>[s.date,s.series,s.character,s.item,s.price,s.fee,s.shipping,s.profit])]
    const text=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/csv'})); a.download='mercari-sales.csv'; a.click()
  }
  return <main className="wrap">
    <h1>メルカリ売上管理</h1>
    <p className="sub">売れた画面のスクショを読み取って、販売価格から手数料10%と送料を引いた利益を計算します。</p>
    <section className="card upload">
      <label>売れた画面のスクショ<input type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0]; if(file) analyze(file)}} /></label>
      <p>{loading?'読み取り中…':message||'画像を選ぶと、作品名・キャラ・商品名・価格を自動入力します。'}</p>
      {debug && <pre className="debug">{debug}</pre>}
    </section>
    <section className="card grid">
      <label>日付<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
      <label>作品名<input placeholder="例：呪術廻戦" value={form.series} onChange={e=>setForm({...form,series:e.target.value})}/></label>
      <label>キャラ<input placeholder="例：伏黒恵" value={form.character} onChange={e=>setForm({...form,character:e.target.value})}/></label>
      <label>商品名<input placeholder="例：アクリルスタンド" value={form.item} onChange={e=>setForm({...form,item:e.target.value})}/></label>
      <label>販売価格<input inputMode="numeric" placeholder="3333" value={form.price} onChange={e=>setForm({...form,price:e.target.value.replace(/[^0-9]/g,'')})}/></label>
      <label>送料<input inputMode="numeric" value={form.shipping} onChange={e=>setForm({...form,shipping:e.target.value.replace(/[^0-9]/g,'')})}/></label>
      <button onClick={add}>追加する</button>
    </section>
    <section className="cards">
      <div className="card"><b>件数</b><strong>{filtered.length}</strong></div>
      <div className="card"><b>利益合計</b><strong>{yen(total)}</strong></div>
      <div className="card"><b>売上合計</b><strong>{yen(filtered.reduce((a,s)=>a+s.price,0))}</strong></div>
    </section>
    <div className="tools"><input placeholder="作品・キャラ・商品で検索" value={q} onChange={e=>setQ(e.target.value)}/><button onClick={csv}>CSV出力</button></div>
    <section className="card"><h2>作品別集計</h2>{bySeries.length?bySeries.map(([name,v])=><div className="row" key={name}><span>{name}（{v.count}件）</span><b>{yen(v.profit)}</b></div>):<p>まだ記録がありません。</p>}</section>
    <section className="card"><h2>記録一覧</h2><div className="table">{filtered.map(s=><div className="sale" key={s.id}><div><b>{s.series}</b> {s.character}<br/><span>{s.date} / {s.item}</span></div><div className="right"><b>{yen(s.profit)}</b><br/><span>{yen(s.price)} - {yen(s.fee)} - {yen(s.shipping)}</span><br/><button className="danger" onClick={()=>remove(s.id)}>削除</button></div></div>)}</div></section>
  </main>
}

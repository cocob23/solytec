import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../state/AuthProvider';
import logo from '../assets/logo.png';
import { supabase } from '../lib/supabaseClient';

type Battery = { id: number; ah: number; unit_price_usd: number; is_active: boolean; margen_ganancia?: number | null };
type CabinetBracket = { min_qty: number; max_qty: number; price_usd: number };
type CalcResult = {
  unit_price_usd: number;
  subtotal_batteries: number;
  cabinet_cost_usd: number;
  subtotal_technical: number;
  gain_pct: number | null;
  final_price_usd: number;
  currency: string;
};
// Extend AppSettings to include cabinet_base_usd
type AppSettings = { gain_pct: number | null; cabinet_pct_ge12: number | null; cabinet_base_usd?: number | null; bonus_threshold_usd?: number | null; bonus_max_vendor_pct?: number | null };

export default function Admin() {
  const { userRow, signOut } = useAuth();
  const [tab, setTab] = useState<'calc'|'bats'|'settings'>('bats');
  const [bats, setBats] = useState<Battery[]>([]);
  const [brackets, setBrackets] = useState<CabinetBracket[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [ok, setOk] = useState<string|null>(null);

  // form agregar batería
  const [newAh, setNewAh] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newMargin, setNewMargin] = useState('');

  // ajustes de margen (remove global gain state)
  // const [gainPct, setGainPct] = useState<string>('');
  const [cabPct, setCabPct] = useState<string>('');
  const [bonusCapStr, setBonusCapStr] = useState<string>('');
  const [settings, setSettings] = useState<AppSettings>({ gain_pct: null, cabinet_pct_ge12: null });

  // calculadora
  const [selAh, setSelAh] = useState<string>('');
  const [qtyInput, setQtyInput] = useState<string>('');
  const [res, setRes] = useState<CalcResult|null>(null);
  const [calcErr, setCalcErr] = useState<string|null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  // Add bonificación state
  const [bonusPctInput, setBonusPctInput] = useState<string>('');
  const [discountedPrice, setDiscountedPrice] = useState<number | null>(null);

  useEffect(() => {
    // Cargar settings globales (fila única)
    supabase
      .from('app_settings')
      .select('cabinet_pct_ge12, cabinet_base_usd, bonus_threshold_usd, bonus_max_vendor_pct')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          // Mantener solo el gabinete en UI; margen global se maneja por batería
          setSettings({ gain_pct: null, cabinet_pct_ge12: data.cabinet_pct_ge12, cabinet_base_usd: (data as any).cabinet_base_usd, bonus_threshold_usd: (data as any).bonus_threshold_usd, bonus_max_vendor_pct: (data as any).bonus_max_vendor_pct });
          setCabPct(data.cabinet_pct_ge12 != null ? String(data.cabinet_pct_ge12) : '');
          const dbCap = (data as any).bonus_max_vendor_pct as number | null | undefined;
          // Mostrar tal cual está en DB (0–1) o 10 por defecto si no hay valor.
          setBonusCapStr(dbCap != null ? String(dbCap) : '10');
        }
      });
  }, []);

  async function loadBats() {
    setErr(null); setOk(null); setLoading(true);
    const { data, error } = await supabase
      .from('batteries')
      .select('id, ah, unit_price_usd, is_active, margen_ganancia')
      .order('ah', { ascending: true });
    setLoading(false);
    if (error) setErr(error.message);
    else setBats((data ?? []) as Battery[]);
  }
  useEffect(() => { loadBats(); }, []);

  useEffect(() => {
    supabase
      .from('cabinet_brackets_lt12')
      .select('min_qty, max_qty, price_usd')
      .order('min_qty', { ascending: true })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setBrackets((data ?? []) as CabinetBracket[]);
      });
  }, []);

  const ahOptions = useMemo(
    () => Array.from(new Set(bats.filter(b=>b.is_active).map((b) => b.ah))).sort((a, b) => a - b),
    [bats]
  );
  // Eliminamos el selector de voltaje en la calculadora del Admin

  function calculate() {
    setCalcErr(null); setRes(null);
    setDiscountedPrice(null);
    const ah = Number(selAh); const qty = Number(qtyInput);
    if (!Number.isFinite(ah) || !Number.isFinite(qty) || qty <= 0) {
      setCalcErr('Completá Ah y cantidad > 0'); return;
    }
    setCalcLoading(true);
    const match = bats.find((b) => b.is_active && b.ah === ah);
    if (!match) { setCalcLoading(false); setCalcErr('No hay precio para ese Ah'); return; }
    const unit = Number(match.unit_price_usd);
    // Usar margen por batería; fallback al usuario o 0.25
    const rawG = (match.margen_ganancia ?? undefined) ?? (userRow?.gain_pct ?? 0.25);
    const g = rawG > 1 ? rawG / 100 : rawG;
    const rawC = (settings.cabinet_pct_ge12 ?? undefined) ?? (userRow?.cabinet_pct_ge12 ?? 0.15);
    const c = rawC > 1 ? rawC / 100 : rawC;
    const subtotal_batteries = unit * qty;
    let cabinet_cost_usd = 0;
    const baseCabinet = Number(settings.cabinet_base_usd ?? 0);
    if (qty === 1 && baseCabinet > 0) {
      cabinet_cost_usd = baseCabinet;
    } else if (ah < 12) {
      if (!brackets || brackets.length === 0) { setCalcLoading(false); setCalcErr('No hay precios de gabinete (LT12) configurados'); return; }
      const sortedDesc = [...brackets].sort((a,b) => b.max_qty - a.max_qty);
      const largest = sortedDesc[0];
      let remaining = qty;
      let cost = 0;
      if (remaining > largest.max_qty) {
        const count = Math.floor(remaining / largest.max_qty);
        cost += count * Number(largest.price_usd);
        remaining = remaining % largest.max_qty;
      }
      if (remaining > 0) {
        const br = brackets.find((b) => remaining >= b.min_qty && remaining <= b.max_qty);
        if (br) cost += Number(br.price_usd);
        else {
          const fallback = [...brackets].sort((a,b)=> a.max_qty - b.max_qty).find(b => remaining <= b.max_qty);
          if (fallback) cost += Number(fallback.price_usd);
          else { setCalcLoading(false); setCalcErr('No hay bracket de gabinete que cubra la cantidad restante (LT12)'); return; }
        }
      }
      cabinet_cost_usd = cost;
    } else {
      // Para ≥12Ah: usar el porcentaje, pero si ese valor es menor al costo base, tomar el base como mínimo
      if (ah >= 12) {
        const percentCost = subtotal_batteries * c;
        // Si hay costo base definido, aplicar el mayor entre porcentaje y base
        cabinet_cost_usd = baseCabinet > 0 ? Math.max(percentCost, baseCabinet) : percentCost;
      } else {
        cabinet_cost_usd = 0;
      }
    }
    const subtotal_technical = subtotal_batteries + cabinet_cost_usd;
    const final_price_usd = subtotal_technical * (1 + g);
    setRes({ unit_price_usd: unit, subtotal_batteries, cabinet_cost_usd, subtotal_technical, gain_pct: g, final_price_usd, currency: 'USD' });
    setCalcLoading(false);
  }

  function applyBonus() {
    if (!res) return;
    const raw = bonusPctInput.trim();
    if (raw === '') { setDiscountedPrice(null); return; }
    let pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0) { setCalcErr('Bonificación inválida'); return; }
    // Interpret numbers >= 1 as percentage (1 => 1%, 10 => 10%)
    if (pct >= 1) pct = pct / 100;
    const newPrice = res.final_price_usd * (1 - pct);
    setDiscountedPrice(newPrice);
  }

  async function saveBattery(b: Battery) {
    setErr(null); setOk(null); setLoading(true);
    const { error } = await supabase
      .from('batteries')
      .update({ unit_price_usd: b.unit_price_usd, is_active: b.is_active, margen_ganancia: b.margen_ganancia ?? null })
      .eq('id', b.id);
    setLoading(false);
    if (error) setErr(error.message); else setOk('Batería actualizada');
  }

  async function addBattery() {
    setErr(null); setOk(null);
    const ah = Number(newAh); const price = Number(newPrice);
    let margin = newMargin === '' ? null : Number(newMargin);
    if (margin != null && Number.isFinite(margin) && margin > 1) margin = margin / 100;
    if (!Number.isFinite(ah) || !Number.isFinite(price)) { setErr('Completa Ah y Precio'); return; }
    setLoading(true);
    const { error } = await supabase
      .from('batteries')
      .insert({ ah, unit_price_usd: price, is_active: true, margen_ganancia: margin });
    setLoading(false);
    if (error) setErr(error.message); else { setOk('Batería agregada'); setNewAh(''); setNewPrice(''); setNewMargin(''); loadBats(); }
  }

  async function saveSettings() {
    setErr(null); setOk(null);
    let c = Number(cabPct);
    if (Number.isFinite(c) && c > 1) c = c / 100;
    if (!Number.isFinite(c)) { setErr('Valor inválido'); return; }
    // Parse bonus cap allowing 0–1 or %; only normalizar al guardar
    const rawCap = bonusCapStr.trim();
    let capNum: number | null = rawCap === '' ? null : Number(rawCap);
    if (capNum != null && !Number.isFinite(capNum)) {
      setErr('Tope de bonificación inválido');
      return;
    } else if (capNum != null && Number.isFinite(capNum)) {
      // Si es >1 tratamos como porcentaje (ej: 10 => 0.10), si es <=1 lo tomamos tal cual (0.2)
      capNum = capNum > 1 ? capNum / 100 : capNum;
    }
    const { error } = await supabase
      .from('app_settings')
      .upsert({ id: 1, cabinet_pct_ge12: c, cabinet_base_usd: (settings.cabinet_base_usd ?? null), bonus_threshold_usd: (settings.bonus_threshold_usd ?? null), bonus_max_vendor_pct: (capNum ?? null) }, { onConflict: 'id' });
    if (error) setErr(error.message); else {
      setOk('Ajustes guardados');
      setSettings({ gain_pct: null, cabinet_pct_ge12: c, cabinet_base_usd: settings.cabinet_base_usd, bonus_threshold_usd: settings.bonus_threshold_usd, bonus_max_vendor_pct: capNum ?? null });
      // Mostrar valor normalizado en 0–1 tras guardar
      setBonusCapStr(capNum != null ? String(capNum) : '');
      setCabPct(String(c));
    }
  }

  return (
    <>
      <style>{`
        .admin-wrap { min-height: 100vh; background:#f5f7fb; padding: 2rem 1rem; font-family: 'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif; }
        .admin-container { max-width: 1000px; margin: 0 auto; position: relative; }
        .topbar { position:absolute; right:0; top:-8px; display:flex; gap:8px; align-items:center; }
        .brand { position:absolute; left:0; top:-8px; display:flex; align-items:center; gap:8px; }
        .brand-logo { height:30px; width:auto; object-fit:contain; }
        .out { background:#e5e7eb; color:#374151; border:none; height:32px; padding:0 10px; border-radius:8px; cursor:pointer; }
        .title { text-align:center; font-size:1.6rem; font-weight:700; margin-bottom:1rem; }
        .tabs { display:flex; gap:12px; justify-content:center; margin-bottom:12px; flex-wrap:wrap; }
        .tab { height:40px; padding:0 14px; border-radius:8px; border:1px solid #d1d5db; background:#fff; cursor:pointer; font-weight:600; }
        .tab.active { background:#0b5ed7; color:#fff; border-color:#0b5ed7; }
        .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,0.05); }
        .card-body { padding: 1.25rem; }
        .muted { color:#6b7280; font-size:0.9rem; }
        .grid4 { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
        .input, .select { width:100%; height:40px; border:1px solid #d1d5db; border-radius:8px; padding:0 12px; font-size:0.95rem; box-sizing:border-box; }
  .btn { display:inline-flex; align-items:center; justify-content:center; height:40px; border-radius:8px; background:#0b5ed7; color:#fff; font-weight:600; border:none; cursor:pointer; }
  .btn-danger { background:#dc2626; }
        .table-wrap { width:100%; overflow-x:auto; }
        .table { width:100%; border-collapse: collapse; min-width: 640px; }
        .table th, .table td { border-bottom:1px solid #eef0f4; padding:8px; text-align:left; }
        .switch { display:inline-flex; align-items:center; gap:8px; }
    .results { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin-top: 12px; }
    .result-item { background:#f9fafb; border:1px solid #eef0f4; border-radius:10px; padding:12px; }
    .total { font-size:1.25rem; font-weight:700; color:#0b5ed7; margin-top: 10px; }

        /* Responsive */
        @media (max-width: 900px) {
          .admin-container { padding-top: 1.5rem; }
          .topbar { position: static; justify-content: flex-end; margin-bottom: 0.5rem; }
        }
        @media (max-width: 768px) {
          .grid4 { grid-template-columns: repeat(2, minmax(0,1fr)); }
          .results { grid-template-columns: repeat(2, minmax(0,1fr)); }
        }
        @media (max-width: 480px) {
          .grid4 { grid-template-columns: 1fr; }
          .results { grid-template-columns: 1fr; }
          .input, .select, .btn { height: 44px; }
          .title { font-size: 1.4rem; }
        }
      `}</style>
      <div className="admin-wrap">
        <div className="admin-container">
          <div className="brand">
            <img src={logo} alt="SOLYTEC" className="brand-logo" />
          </div>
          <div className="topbar">
            <span className="muted">{userRow?.full_name} (Admin)</span>
            <button className="out" onClick={signOut}>Salir</button>
          </div>
          <h2 className="title">Panel de Administración</h2>

          <div className="tabs">
            <button className={`tab ${tab==='calc'?'active':''}`} onClick={() => setTab('calc')}>Calculadora</button>
            <button className={`tab ${tab==='bats'?'active':''}`} onClick={() => setTab('bats')}>Gestionar Baterías</button>
            <button className={`tab ${tab==='settings'?'active':''}`} onClick={() => setTab('settings')}>Ajustes Generales</button>
          </div>

          {tab==='calc' && (
            <div className="card">
              <div className="card-body">
                <div className="grid4">
                  <div>
                    <label className="muted">Ah</label>
                    <select className="select" value={selAh} onChange={(e)=>setSelAh(e.target.value)}>
                      <option value="">Elegir Ah</option>
                      {ahOptions.map((v)=> <option key={v} value={String(v)}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="muted">Cantidad</label>
                    <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="1" value={qtyInput} onChange={(e)=>setQtyInput(e.target.value.replace(/[^0-9]/g,''))} />
                  </div>
                  <div style={{alignSelf:'end'}}>
                    <button className="btn" onClick={calculate} disabled={calcLoading}>{calcLoading ? 'Calculando…' : 'Calcular'}</button>
                  </div>
                </div>
                {calcErr && <p style={{color:'crimson', marginTop:10}}>{calcErr}</p>}
                {res && (
                  <>
                    <div className="results">
                      <div className="result-item"><div className="muted">Precio unitario</div><div>USD {res.unit_price_usd.toFixed(2)}</div></div>
                      <div className="result-item"><div className="muted">Subtotal baterías</div><div>USD {res.subtotal_batteries.toFixed(2)}</div></div>
                      <div className="result-item"><div className="muted">Costo gabinete</div><div>USD {res.cabinet_cost_usd.toFixed(2)}</div></div>
                      <div className="result-item"><div className="muted">Subtotal técnico</div><div>USD {res.subtotal_technical.toFixed(2)}</div></div>
                    </div>
                    <p className="muted" style={{marginTop:10}}>Margen de ganancia: {(res.gain_pct! * 100).toFixed(2)}%</p>
                    <div className="total" style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                      <span>Precio final: USD {res.final_price_usd.toFixed(2)}</span>
                      <input
                        className="input"
                        style={{ width: 140 }}
                        placeholder="Bonificación %"
                        type="text"
                        inputMode="decimal"
                        value={bonusPctInput}
                        onChange={(e)=> setBonusPctInput(e.target.value.replace(/[^0-9.]/g,''))}
                      />
                      <button className="btn" style={{ width: 'auto', padding: '0 12px' }} onClick={applyBonus}>Aplicar bonificación</button>
                    </div>
                    {discountedPrice != null && (
                      <div className="total" style={{ color:'#065f46' }}>Precio con bonificación: USD {discountedPrice.toFixed(2)}</div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {tab==='bats' && (
            <div className="card">
              <div className="card-body">
                <p className="muted">Listado del catálogo</p>
                {err && <p style={{ color: 'crimson' }}>{err}</p>}
                {ok && <p style={{ color: '#0b5ed7' }}>{ok}</p>}
                <div className="table-wrap" style={{marginTop:8}}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ah</th>
                      <th>Precio (USD)</th>
                      <th>Activo</th>
                      <th>Margen de ganancia</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bats.map((b, idx) => (
                      <tr key={`${b.id}-${idx}`}>
                        <td>{b.ah}</td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            step="0.01"
                            value={b.unit_price_usd}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setBats((prev) => prev.map((x, i) => (i === idx ? { ...x, unit_price_usd: v } : x)));
                            }}
                          />
                        </td>
                        <td>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={b.is_active}
                              onChange={(e) =>
                                setBats((prev) => prev.map((x, i) => (i === idx ? { ...x, is_active: e.target.checked } : x)))
                              }
                            />
                            <span className="muted">{b.is_active ? 'Sí' : 'No'}</span>
                          </label>
                        </td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            step="0.01"
                            min="0"
                            max="1"
                            placeholder="0.25 o 25%"
                            value={b.margen_ganancia ?? ''}
                            onChange={(e) => {
                              let num: number | null = e.target.value === '' ? null : Number(e.target.value);
                              if (num != null && Number.isFinite(num) && num > 1) num = num / 100;
                              setBats((prev) => prev.map((x, i) => (i === idx ? { ...x, margen_ganancia: num } : x)));
                            }}
                          />
                          <span className="muted" style={{ fontSize: '0.8rem' }}>0–1 o % (ej: 25 = 25%)</span>
                        </td>
                        <td style={{ display: 'flex', gap: 8 }}>
                          <button className="btn" onClick={() => saveBattery(b)} disabled={loading}>
                            Guardar
                          </button>
                          <button
                            className="btn btn-danger"
                            onClick={async () => {
                              if (!confirm('¿Estás seguro de borrarla? Esta acción no se puede deshacer.')) return;
                              setErr(null);
                              setOk(null);
                              setLoading(true);
                              const { error } = await supabase.from('batteries').delete().eq('id', b.id);
                              setLoading(false);
                              if (error) setErr(error.message);
                              else {
                                setOk('Batería borrada');
                                loadBats();
                              }
                            }}
                            disabled={loading}
                          >
                            Borrar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                <h3 style={{marginTop:16}}>Agregar batería</h3>
                <div className="grid4" style={{marginTop:8}}>
                  <input className="input" placeholder="Ah" value={newAh} onChange={(e)=>setNewAh(e.target.value.replace(/[^0-9]/g,''))} />
                  <input className="input" placeholder="Precio USD" value={newPrice} onChange={(e)=>setNewPrice(e.target.value.replace(/[^0-9.]/g,''))} />
                  <input className="input" placeholder="Margen (0–1 o %)" value={newMargin} onChange={(e)=>setNewMargin(e.target.value.replace(/[^0-9.]/g,''))} />
                  
                  <button className="btn" onClick={addBattery} disabled={loading}>Agregar</button>
                </div>
              </div>
            </div>
          )}

          {tab==='settings' && (
            <div className="card">
              <div className="card-body">
                <p className="muted">Ajustes globales de gabinete aplicados al cálculo</p>
                {err && <p style={{ color: 'crimson' }}>{err}</p>}
                {ok && <p style={{ color: '#0b5ed7' }}>{ok}</p>}
                <div className="grid4" style={{marginTop:8}}>
                  <div>
                    <label className="muted">Gabinete ≥12Ah (0–1 o %)</label>
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9.]*"
                      value={cabPct}
                      onChange={(e)=>{
                        // permitir solo dígitos y punto; mantener como string para luego convertir al guardar
                        const raw = e.target.value.replace(/[^0-9.]/g,'');
                        setCabPct(raw);
                      }}
                    />
                    <p className="muted" style={{ marginTop: 6 }}>
                      Es el porcentaje del valor del gabinete calculado según el costo total de las baterías (aplica para ≥12Ah).
                    </p>
                  </div>
                  <div>
                    <label className="muted">Costo base gabinete (qty = 1)</label>
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9.]*"
                      placeholder="50"
                      value={settings.cabinet_base_usd ?? ''}
                      onChange={(e)=>{
                        const raw = e.target.value.replace(/[^0-9.]/g,'').trim();
                        const val = raw === '' ? null : Number(raw);
                        setSettings((s)=> ({ ...s, cabinet_base_usd: Number.isFinite(val as number) ? val : s.cabinet_base_usd ?? null }));
                      }}
                    />
                    <p className="muted" style={{ marginTop: 6 }}>Se aplica sólo cuando la cantidad es 1.</p>
                  </div>
                  <div>
                    <label className="muted">Umbral bonificación (USD)</label>
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9.]*"
                      placeholder="ej: 1000"
                      value={settings.bonus_threshold_usd ?? ''}
                      onChange={(e)=>{
                        const raw = e.target.value.replace(/[^0-9.]/g,'').trim();
                        const val = raw === '' ? null : Number(raw);
                        setSettings((s)=> ({ ...s, bonus_threshold_usd: Number.isFinite(val as number) ? val : s.bonus_threshold_usd ?? null }));
                      }}
                    />
                    <p className="muted" style={{ marginTop: 6 }}>Para vendedores: sólo aparece el botón si el precio final alcanza este importe.</p>
                  </div>
                  <div>
                    <label className="muted">Tope bonificación (0–1 o %)</label>
                    <input
                      className="input"
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9.]*"
                      placeholder="ej: 0.15 o 15"
                      value={bonusCapStr}
                      onChange={(e)=>{
                        const cleaned = e.target.value
                          .replace(/[^0-9.]/g, '')
                          .replace(/(\..*)\./g, '$1');
                        setBonusCapStr(cleaned);
                      }}
                    />
                    <p className="muted" style={{ marginTop: 6 }}>Acepta 0–1 o %. Se guarda en 0–1. Ejemplos: 0.45 = 45%; 45 = 45% (al guardar se mostrará 0.45). Vacío = sin tope.</p>
                  </div>
                  <div style={{alignSelf:'end'}}>
                    <button className="btn" onClick={saveSettings} disabled={loading}>Guardar ajustes</button>
                  </div>
                </div>
                <p className="muted" style={{marginTop:10}}>El margen de ganancia se edita por batería en "Gestionar Baterías".</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

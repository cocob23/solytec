import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../state/AuthProvider';
import logo from '../assets/logo.png';
import { supabase } from '../lib/supabaseClient';

type Battery = { voltage_v: number; ah: number; unit_price_usd: number; is_active: boolean };
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
type AppSettings = { gain_pct: number | null; cabinet_pct_ge12: number | null };

export default function Admin() {
  const { userRow, signOut } = useAuth();
  const [tab, setTab] = useState<'calc'|'bats'|'settings'>('bats');
  const [bats, setBats] = useState<Battery[]>([]);
  const [brackets, setBrackets] = useState<CabinetBracket[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [ok, setOk] = useState<string|null>(null);

  // form agregar batería
  const [newVolt, setNewVolt] = useState('');
  const [newAh, setNewAh] = useState('');
  const [newPrice, setNewPrice] = useState('');

  // ajustes de margen
  const [gainPct, setGainPct] = useState<string>('');
  const [cabPct, setCabPct] = useState<string>('');
  const [settings, setSettings] = useState<AppSettings>({ gain_pct: null, cabinet_pct_ge12: null });

  // calculadora
  const [selAh, setSelAh] = useState<string>('');
  const [selVolt, setSelVolt] = useState<string>('');
  const [qtyInput, setQtyInput] = useState<string>('');
  const [res, setRes] = useState<CalcResult|null>(null);
  const [calcErr, setCalcErr] = useState<string|null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  useEffect(() => {
    // Cargar settings globales (fila única)
    supabase
      .from('app_settings')
      .select('gain_pct, cabinet_pct_ge12')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setSettings({ gain_pct: data.gain_pct, cabinet_pct_ge12: data.cabinet_pct_ge12 });
          setGainPct(data.gain_pct != null ? String(data.gain_pct) : '');
          setCabPct(data.cabinet_pct_ge12 != null ? String(data.cabinet_pct_ge12) : '');
        }
      });
  }, []);

  async function loadBats() {
    setErr(null); setOk(null); setLoading(true);
    const { data, error } = await supabase
      .from('batteries')
      .select('voltage_v, ah, unit_price_usd, is_active')
      .order('ah', { ascending: true })
      .order('voltage_v', { ascending: true });
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
  const voltOptions = useMemo(
    () => (selAh === '' ? [] : bats.filter((b) => b.is_active && String(b.ah) === selAh).map((b) => b.voltage_v)),
    [bats, selAh]
  );

  function calculate() {
    setCalcErr(null); setRes(null);
    const ah = Number(selAh); const volt = Number(selVolt); const qty = Number(qtyInput);
    if (!Number.isFinite(ah) || !Number.isFinite(volt) || !Number.isFinite(qty) || qty <= 0) {
      setCalcErr('Completá Ah, Volt y cantidad > 0'); return;
    }
    setCalcLoading(true);
    const match = bats.find((b) => b.is_active && b.ah === ah && b.voltage_v === volt);
    if (!match) { setCalcLoading(false); setCalcErr('No hay precio para esa combinación'); return; }
    const unit = Number(match.unit_price_usd);
    const rawG = (settings.gain_pct ?? undefined) ?? (userRow?.gain_pct ?? 0.25);
    const g = rawG > 1 ? rawG / 100 : rawG;
    const rawC = (settings.cabinet_pct_ge12 ?? undefined) ?? (userRow?.cabinet_pct_ge12 ?? 0.15);
    const c = rawC > 1 ? rawC / 100 : rawC;
    const subtotal_batteries = unit * qty;
    let cabinet_cost_usd = 0;
    if (ah < 12) {
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
      cabinet_cost_usd = ah >= 12 ? subtotal_batteries * c : 0;
    }
    const subtotal_technical = subtotal_batteries + cabinet_cost_usd;
  const final_price_usd = subtotal_technical * (1 + g);
    setRes({
      unit_price_usd: unit,
      subtotal_batteries,
      cabinet_cost_usd,
      subtotal_technical,
      gain_pct: g,
      final_price_usd,
      currency: 'USD',
    });
    setCalcLoading(false);
  }

  async function saveBattery(b: Battery) {
    setErr(null); setOk(null); setLoading(true);
    const { error } = await supabase
      .from('batteries')
  .update({ unit_price_usd: b.unit_price_usd, is_active: b.is_active })
      .eq('ah', b.ah)
      .eq('voltage_v', b.voltage_v);
    setLoading(false);
    if (error) setErr(error.message); else setOk('Batería actualizada');
  }

  async function addBattery() {
    setErr(null); setOk(null);
    const volt = Number(newVolt); const ah = Number(newAh); const price = Number(newPrice);
    if (!Number.isFinite(volt) || !Number.isFinite(ah) || !Number.isFinite(price)) { setErr('Completa Volt, Ah y Precio'); return; }
    setLoading(true);
    const { error } = await supabase
      .from('batteries')
      .insert({ voltage_v: volt, ah, unit_price_usd: price, is_active: true });
    setLoading(false);
    if (error) setErr(error.message); else { setOk('Batería agregada'); setNewVolt(''); setNewAh(''); setNewPrice(''); loadBats(); }
  }

  async function saveSettings() {
    setErr(null); setOk(null);
    let g = Number(gainPct); let c = Number(cabPct);
    // Normalizar: si ingresan 80 lo tomamos como 80% => 0.8
    if (Number.isFinite(g) && g > 1) g = g / 100;
    if (Number.isFinite(c) && c > 1) c = c / 100;
    if (!Number.isFinite(g) || !Number.isFinite(c)) { setErr('Valores inválidos'); return; }
    const { error } = await supabase
      .from('app_settings')
      .upsert({ id: 1, gain_pct: g, cabinet_pct_ge12: c }, { onConflict: 'id' });
    if (error) setErr(error.message); else { setOk('Ajustes guardados'); setSettings({ gain_pct: g, cabinet_pct_ge12: c }); }
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
            <button className={`tab ${tab==='settings'?'active':''}`} onClick={() => setTab('settings')}>Ajustes de Margen</button>
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
                    <label className="muted">Voltaje</label>
                    <select className="select" value={selVolt} onChange={(e)=>setSelVolt(e.target.value)} disabled={selAh===''}>
                      <option value="">Elegir Volt</option>
                      {Array.from(new Set(voltOptions)).map((v)=> <option key={v} value={String(v)}>{v}V</option>)}
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
                    <div className="total">Precio final: USD {res.final_price_usd.toFixed(2)}</div>
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
                      <th>Volt</th>
                      <th>Ah</th>
                      <th>Precio (USD)</th>
                      <th>Activo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bats.map((b, idx) => (
                      <tr key={`${b.voltage_v}-${b.ah}-${idx}`}>
                        <td>{b.voltage_v}V</td>
                        <td>{b.ah}</td>
                        <td>
                          <input className="input" type="number" step="0.01" value={b.unit_price_usd}
                                 onChange={(e) => {
                                   const v = Number(e.target.value);
                                   setBats((prev) => prev.map((x, i) => i===idx ? { ...x, unit_price_usd: v } : x));
                                 }} />
                        </td>
                        <td>
                          <label className="switch">
                            <input type="checkbox" checked={b.is_active}
                                   onChange={(e) => setBats((prev) => prev.map((x, i) => i===idx ? { ...x, is_active: e.target.checked } : x))} />
                            <span className="muted">{b.is_active ? 'Sí' : 'No'}</span>
                          </label>
                        </td>
                        <td style={{display:'flex', gap:8}}>
                          <button className="btn" onClick={() => saveBattery(b)} disabled={loading}>Guardar</button>
                          <button className="btn btn-danger" onClick={async () => {
                            if (!confirm('¿Estás seguro de borrarla? Esta acción no se puede deshacer.')) return;
                            setErr(null); setOk(null); setLoading(true);
                            const { error } = await supabase
                              .from('batteries')
                              .delete()
                              .eq('ah', b.ah)
                              .eq('voltage_v', b.voltage_v);
                            setLoading(false);
                            if (error) setErr(error.message); else { setOk('Batería borrada'); loadBats(); }
                          }} disabled={loading}>Borrar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                <h3 style={{marginTop:16}}>Agregar batería</h3>
                <div className="grid4" style={{marginTop:8}}>
                  <input className="input" placeholder="Volt" value={newVolt} onChange={(e)=>setNewVolt(e.target.value.replace(/[^0-9]/g,''))} />
                  <input className="input" placeholder="Ah" value={newAh} onChange={(e)=>setNewAh(e.target.value.replace(/[^0-9]/g,''))} />
                  <input className="input" placeholder="Precio USD" value={newPrice} onChange={(e)=>setNewPrice(e.target.value.replace(/[^0-9.]/g,''))} />
                  
                  <button className="btn" onClick={addBattery} disabled={loading}>Agregar</button>
                </div>
              </div>
            </div>
          )}

          {tab==='settings' && (
            <div className="card">
              <div className="card-body">
                <p className="muted">Ajustes globales aplicados al cálculo (ambas calculadoras)</p>
                {err && <p style={{ color: 'crimson' }}>{err}</p>}
                {ok && <p style={{ color: '#0b5ed7' }}>{ok}</p>}
                <div className="grid4" style={{marginTop:8}}>
                  <div>
                    <label className="muted">Margen de ganancia (0–1 o %)</label>
                    <input className="input" type="number" step="0.01" value={gainPct} onChange={(e)=>setGainPct(e.target.value)} />
                  </div>
                  <div>
                    <label className="muted">Gabinete ≥12Ah (0–1 o %)</label>
                    <input className="input" type="number" step="0.01" value={cabPct} onChange={(e)=>setCabPct(e.target.value)} />
                  </div>
                  <div style={{alignSelf:'end'}}>
                    <button className="btn" onClick={saveSettings} disabled={loading}>Guardar ajustes</button>
                  </div>
                </div>
                <p className="muted" style={{marginTop:10}}>El vendedor no ve el valor del margen, pero el precio final lo incluye.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

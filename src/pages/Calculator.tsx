import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import logo from '../assets/logo.png';
import { useAuth } from '../state/AuthProvider';

type Battery = { voltage_v: number; ah: number; unit_price_usd: number };
type CabinetBracket = { min_qty: number; max_qty: number; price_usd: number };
type AppSettings = { gain_pct: number | null; cabinet_pct_ge12: number | null };

type CalcResult = {
  unit_price_usd: number;
  subtotal_batteries: number;
  cabinet_cost_usd: number;
  subtotal_technical: number;
  gain_pct: number | null;
  final_price_usd: number;
  currency: string;
};

export default function Calculator() {
  const { userRow, signOut } = useAuth();
  // Config simple en frontend (luego se puede mover a un panel Admin)
  const CONFIG = {
    gainPct: 0.25,          // 25% de margen (fallback si no hay valor en DB)
    cabinetPctGe12: 0.15,   // 15% gabinete para >=12Ah (fallback)
    currency: 'USD' as const,
  };
  const [bats, setBats] = useState<Battery[]>([]);
  const [brackets, setBrackets] = useState<CabinetBracket[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ gain_pct: null, cabinet_pct_ge12: null });
  const [ah, setAh] = useState<number | ''>('');
  const [volt, setVolt] = useState<number | ''>('');
  const [qtyInput, setQtyInput] = useState<string>('');
  const [res, setRes] = useState<CalcResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from('batteries')
      .select('*')
      .eq('is_active', true)
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setBats((data ?? []) as Battery[]);
      });
    supabase
      .from('cabinet_brackets_lt12')
      .select('min_qty, max_qty, price_usd')
      .order('min_qty', { ascending: true })
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setBrackets((data ?? []) as CabinetBracket[]);
      });
    // load global settings (singleton id=1)
    supabase
      .from('app_settings')
      .select('gain_pct, cabinet_pct_ge12')
      .limit(1)
      .single()
      .then(({ data, error }) => {
        if (!error && data) setSettings({ gain_pct: data.gain_pct, cabinet_pct_ge12: data.cabinet_pct_ge12 });
      });
  }, []);

  const ahOptions = useMemo(
    () => Array.from(new Set(bats.map((b) => b.ah))).sort((a, b) => a - b),
    [bats]
  );
  const voltOptions = useMemo(
    () => (ah === '' ? [] : bats.filter((b) => b.ah === ah).map((b) => b.voltage_v)),
    [bats, ah]
  );

  useEffect(() => {
    // reset volt when ah changes; preselect if only one
    if (ah === '') {
      setVolt('');
      return;
    }
    const vs = voltsUnique(voltOptions);
    if (vs.length === 1) setVolt(vs[0]);
    else setVolt('');
  }, [ah]);

  async function calculate() {
    setErr(null);
    setRes(null);
    const qty = Number(qtyInput);
    if (ah === '' || volt === '' || !Number.isFinite(qty) || qty <= 0) {
      setErr('Seleccioná Ah, Volt y cantidad > 0');
      return;
    }
    setLoading(true);
    // Encontrar precio unitario desde el catálogo cargado
    const match = bats.find((b) => b.ah === ah && b.voltage_v === volt);
    if (!match) {
      setLoading(false);
      setErr('No hay precio para esa combinación (Ah/Volt)');
      return;
    }
  const unit = Number(match.unit_price_usd);
  const rawGain = (settings.gain_pct ?? undefined) ?? (userRow?.gain_pct ?? CONFIG.gainPct);
  const gainPct = rawGain > 1 ? rawGain / 100 : rawGain; // permite cargar 80 como 80%
  const rawCabPct = (settings.cabinet_pct_ge12 ?? undefined) ?? (userRow?.cabinet_pct_ge12 ?? CONFIG.cabinetPctGe12);
  const cabinetPct = rawCabPct > 1 ? rawCabPct / 100 : rawCabPct;
  const subtotal_batteries = unit * qty;
  let cabinet_cost_usd = 0;
  if ((ah as number) < 12) {
    // Bracket packing: usa gabinetes grandes tantas veces como haga falta y uno adicional para el resto
    if (!brackets || brackets.length === 0) {
      setLoading(false);
      setErr('No hay precios de gabinete (LT12) configurados');
      return;
    }
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
        // Fallback por si hay huecos
        const fallback = [...brackets].sort((a,b)=> a.max_qty - b.max_qty).find(b => remaining <= b.max_qty);
        if (fallback) cost += Number(fallback.price_usd);
        else {
          setLoading(false);
          setErr('No hay bracket de gabinete que cubra la cantidad restante (LT12)');
          return;
        }
      }
    }
    cabinet_cost_usd = cost;
  } else {
    cabinet_cost_usd = (ah as number) >= 12 ? subtotal_batteries * cabinetPct : 0;
  }
    const subtotal_technical = subtotal_batteries + cabinet_cost_usd;
  const final_price_usd = subtotal_technical * (1 + gainPct);
  const gain_pct = userRow?.role === 'admin' ? gainPct : null;
    setRes({
      unit_price_usd: unit,
      subtotal_batteries,
      cabinet_cost_usd,
      subtotal_technical,
      gain_pct,
      final_price_usd,
      currency: CONFIG.currency,
    });
    setLoading(false);
  }

  return (
    <>
      <style>{`
        .calc-wrap { min-height: 100vh; background:#f5f7fb; padding: 2rem 1rem; font-family: 'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif; }
  .calc-container { max-width: 900px; margin: 0 auto; position: relative; }
  .topbar { position:absolute; right:0; top:-8px; display:flex; gap:8px; align-items:center; }
  .brand { position:absolute; left:0; top:-8px; display:flex; align-items:center; gap:8px; }
  .brand-logo { height:30px; width:auto; object-fit:contain; }
  .out { background:#e5e7eb; color:#374151; border:none; height:32px; padding:0 10px; border-radius:8px; cursor:pointer; }
        .calc-title { text-align:center; font-size:1.6rem; font-weight:700; margin: 0 0 1rem; }
        .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,0.05); }
        .card-body { padding: 1.25rem; }
        .grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
        .label { display:block; font-size:0.95rem; font-weight:600; color:#374151; margin-bottom:0.25rem; }
        .input, .select { width:100%; height:40px; border:1px solid #d1d5db; border-radius:8px; padding:0 12px; font-size:0.95rem; box-sizing:border-box; }
        .btn { display:inline-flex; align-items:center; justify-content:center; width:100%; height:40px; border-radius:8px; background:#0b5ed7; color:#fff; font-weight:600; border:none; cursor:pointer; }
        .muted { color:#6b7280; font-size:0.9rem; }
        .results { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin-top: 12px; }
        .result-item { background:#f9fafb; border:1px solid #eef0f4; border-radius:10px; padding:12px; }
        .total { font-size:1.25rem; font-weight:700; color:#0b5ed7; margin-top: 10px; }

        /* Responsive tweaks */
        @media (max-width: 900px) {
          .calc-container { padding-top: 1.5rem; }
          .topbar { position: static; justify-content: flex-end; margin-bottom: 0.5rem; }
        }
        @media (max-width: 768px) {
          .grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
          .results { grid-template-columns: repeat(2, minmax(0,1fr)); }
        }
        @media (max-width: 480px) {
          .grid { grid-template-columns: 1fr; }
          .results { grid-template-columns: 1fr; }
          .calc-title { font-size: 1.3rem; }
          .input, .select, .btn { height: 44px; }
        }
      `}</style>
      <div className="calc-wrap">
        <div className="calc-container">
          <div className="brand">
            <img src={logo} alt="SOLYTEC" className="brand-logo" />
          </div>
          <div className="topbar">
            <span className="muted">{userRow?.full_name} ({userRow?.role === 'vendor' ? 'Vendedor' : 'Admin'})</span>
            <button className="out" onClick={signOut}>Salir</button>
          </div>
          <h2 className="calc-title">Calculadora</h2>
          <div className="card">
            <div className="card-body">
              <div className="grid">
                <div>
                  <label className="label">Ah</label>
                  <select className="select" value={ah} onChange={(e) => setAh(Number(e.target.value) || '')}>
                    <option value="">Elegir Ah</option>
                    {ahOptions.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Voltaje</label>
                  <select className="select" value={volt} onChange={(e) => setVolt(Number(e.target.value) || '')} disabled={ah === ''}>
                    <option value="">Elegir Volt</option>
                    {voltsUnique(voltOptions).map((v) => (
                      <option key={v} value={v}>{v}V</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Cantidad</label>
                  <input
                    className="input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="1"
                    value={qtyInput}
                    onChange={(e) => setQtyInput(e.target.value.replace(/[^0-9]/g, ''))}
                  />
                </div>
                <div style={{ alignSelf: 'end' }}>
                  <button className="btn" onClick={calculate} disabled={loading}>{loading ? 'Calculando…' : 'Calcular'}</button>
                </div>
              </div>
              {err && <p style={{ color: 'crimson', marginTop: 10 }}>{err}</p>}
              {res && userRow?.role === 'admin' && (
                <div className="results">
                  <div className="result-item"><div className="muted">Precio unitario</div> <div>USD {res.unit_price_usd.toFixed(2)}</div></div>
                  <div className="result-item"><div className="muted">Subtotal baterías</div> <div>USD {res.subtotal_batteries.toFixed(2)}</div></div>
                  <div className="result-item"><div className="muted">Costo gabinete</div> <div>USD {res.cabinet_cost_usd.toFixed(2)}</div></div>
                  <div className="result-item"><div className="muted">Subtotal técnico</div> <div>USD {res.subtotal_technical.toFixed(2)}</div></div>
                </div>
              )}
              {res && (
                <div>
                  {userRow?.role === 'admin' && res.gain_pct != null && (
                    <p className="muted" style={{ marginTop: 10 }}>Margen aplicado: {(res.gain_pct * 100).toFixed(2)}%</p>
                  )}
                  <div className="total">Precio final: USD {res.final_price_usd.toFixed(2)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function voltsUnique(arr: number[]) {
  return Array.from(new Set(arr));
}

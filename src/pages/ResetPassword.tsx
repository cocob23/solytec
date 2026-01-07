import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import logo from '../assets/logo.png';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [err, setErr] = useState<string|null>(null);
  const [ok, setOk] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // When user lands here from email, Supabase should have set a recovery session
    // We can optionally verify a session exists; if not, prompt to request the email again
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setErr('El enlace de recuperación expiró o es inválido. Solicitá uno nuevo.');
      }
    });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null); setOk(null);
    if (!password || password.length < 6) { setErr('La nueva contraseña debe tener al menos 6 caracteres.'); return; }
    if (password !== password2) { setErr('Las contraseñas no coinciden.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setOk('Contraseña actualizada. Redirigiendo al login...');
    setTimeout(() => navigate('/login', { replace: true }), 1200);
  };

  return (
    <div className="reset-wrap" style={{ minHeight: '100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f9fafb', padding:'2rem 1rem', fontFamily:'Poppins, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Liberation Sans, sans-serif' }}>
      <style>{`
        /* Evita que los inputs se desborden del contenedor por padding/border */
        .reset-wrap *, .reset-wrap *::before, .reset-wrap *::after { box-sizing: border-box; }
      `}</style>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <img src={logo} alt="SOLYTEC" style={{ display:'block', width:300, maxWidth:'100%', margin:'0 auto 0.75rem auto', objectFit:'contain' }} />
        <h1 style={{ textAlign:'center', fontSize:'1.6rem', fontWeight:700, margin:'0.25rem 0' }}>Restablecer contraseña</h1>
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, boxShadow:'0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ padding:'1.25rem' }}>
            <form onSubmit={submit}>
              <div style={{ marginBottom:'0.75rem' }}>
                <label style={{ display:'block', fontSize:'0.95rem', fontWeight:600, color:'#374151', marginBottom:4 }}>Nueva contraseña</label>
                <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)}
                       placeholder="••••••••" style={{ display:'block', width:'100%', maxWidth:'100%', height:40, border:'1px solid #d1d5db', borderRadius:8, padding:'0 12px', fontSize:'0.95rem' }} />
              </div>
              <div style={{ marginBottom:'0.75rem' }}>
                <label style={{ display:'block', fontSize:'0.95rem', fontWeight:600, color:'#374151', marginBottom:4 }}>Repetir contraseña</label>
                <input type="password" value={password2} onChange={(e)=>setPassword2(e.target.value)}
                       placeholder="••••••••" style={{ display:'block', width:'100%', maxWidth:'100%', height:40, border:'1px solid #d1d5db', borderRadius:8, padding:'0 12px', fontSize:'0.95rem' }} />
              </div>
              <button type="submit" disabled={loading} style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'100%', maxWidth:'100%', height:40, borderRadius:8, background:'#0b5ed7', color:'#fff', fontWeight:600, border:'none', cursor:'pointer' }}>{loading ? 'Guardando…' : 'Guardar'}</button>
              {err && <p style={{ color:'#dc2626', marginTop:8 }}>{err}</p>}
              {ok && <p style={{ color:'#065f46', marginTop:8 }}>{ok}</p>}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

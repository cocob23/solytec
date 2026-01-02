import { FormEvent, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import logo from '../assets/logo.png';
import { useAuth } from '../state/AuthProvider';

export default function Login() {
  const navigate = useNavigate();
  const { session, userRow } = useAuth();
  const [userOrEmail, setUserOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session && userRow) {
      navigate(userRow.role === 'admin' ? '/admin' : '/', { replace: true });
    }
  }, [session, userRow]);

  const resolveEmail = async (value: string): Promise<string | null> => {
    // If looks like an email, return as-is
    if (value.includes('@')) return value;
    // Try resolving username -> email via RPC (to be created in Supabase)
    const { data, error } = await supabase.rpc('resolve_email', { p_username: value });
    if (error) return null;
    return (data as string) ?? null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const email = await resolveEmail(userOrEmail);
    if (!email) {
      setErr('Usuario o email no encontrado.');
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setLoading(false);
    if (!error) {
      // fetch role -> redirect
      const { data } = await supabase
        .from('users')
        .select('role')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();
      const role = (data as any)?.role;
      navigate(role === 'admin' ? '/admin' : '/', { replace: true });
    }
  };

  const sendReset = async () => {
    setErr(null);
    if (!userOrEmail) { setErr('Ingresá tu usuario o email para enviar el enlace de recuperación.'); return; }
    const email = await resolveEmail(userOrEmail);
    if (!email) { setErr('Usuario o email no encontrado.'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) setErr(error.message);
    else setErr('Te enviamos un email para recuperar la contraseña.');
  };

  return (
    <>
      <style>{`
        .login-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
          background: #f9fafb;
          font-family: 'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif;
        }
        /* Evita desbordes por padding/border en los inputs */
        .login-wrap *, .login-wrap *::before, .login-wrap *::after { box-sizing: border-box; }
  .login-container { width: 100%; max-width: 440px; }
        .login-logo {
          display: block;
          width: 300px; height: auto; max-width: 100%;
          margin: 0 auto 0.75rem auto;
          object-fit: contain;
        }
  .login-title { text-align: center; font-size: 1.6rem; font-weight: 700; margin: 0.25rem 0; }
  .login-subtitle { text-align: center; font-size: 0.95rem; color: #6b7280; margin-bottom: 1rem; }
  .login-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 1px 2px rgba(0,0,0,0.05); }
        .login-card-content { padding:1.25rem; }
  .login-label { display:block; font-size:0.95rem; font-weight:600; color:#374151; margin-bottom:0.25rem; }
        .login-input {
          display:block; width:100%; max-width:100%; height:40px;
          border:1px solid #d1d5db; border-radius:8px; padding:0 12px; font-size:0.95rem;
        }
  .login-actions { display:flex; gap:0.5rem; }
        .login-toggle { height:40px; padding:0 12px; border:1px solid #d1d5db; border-radius:8px; background:#fff; color:#374151; font-weight:600; cursor:pointer; }
        .login-toggle:hover { background:#f3f4f6; }
        .login-btn { display:inline-flex; align-items:center; justify-content:center; width:100%; height:40px; border-radius:8px; background:#0b5ed7; color:#fff; font-weight:600; border:none; cursor:pointer; }
        .login-btn:disabled { opacity:0.7; cursor:default; }
        .login-link { background:none; border:none; padding:0; color:#0b5ed7; font-size:0.9rem; cursor:pointer; }
        .login-error { color:#dc2626; font-size:0.9rem; }

        /* Responsive tweaks */
        @media (max-width: 480px) {
          .login-card-content { padding: 1rem; }
          .login-title { font-size: 1.4rem; }
          .login-input, .login-toggle, .login-btn { height: 44px; }
          .login-actions { flex-direction: column; }
        }
      `}</style>
      <div className="login-wrap">
      <div className="login-container">
  {/* Logo arriba */}
  <img src={logo} alt="SOLYTEC" className="login-logo" />
        <h1 className="login-title">Iniciar Sesión</h1>

        {/* Card con formulario */}
        <Card className="login-card">
          <CardContent className="login-card-content">
            <form onSubmit={submit}>
              <div style={{ marginBottom: '0.75rem' }}>
                <Label htmlFor="userOrEmail" className="login-label">Usuario o Email</Label>
                <Input
                  id="userOrEmail"
                  type="text"
                  required
                  placeholder="tu usuario o tu@email.com"
                  value={userOrEmail}
                  onChange={(e) => setUserOrEmail(e.target.value)}
                  className="login-input"
                />
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <Label htmlFor="password" className="login-label">Contraseña</Label>
                <div className="login-actions">
                  <Input
                    id="password"
                    type={showPass ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="login-input"
                  />
                  <Button type="button" variant="outline" className="login-toggle" onClick={() => setShowPass((v) => !v)}>
                    {showPass ? 'Ocultar' : 'Ver'}
                  </Button>
                </div>
              </div>
              <Button type="submit" disabled={loading} className="login-btn">
                {loading ? 'Ingresando…' : 'Iniciar Sesión'}
              </Button>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem' }}>
                <button type="button" className="login-link" onClick={sendReset}>Olvidé mi contraseña</button>
              </div>
              {err && <p className="login-error">{err}</p>}
            </form>
          </CardContent>
        </Card>
      </div>
      </div>
    </>
  );
}

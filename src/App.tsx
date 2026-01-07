import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './state/AuthProvider';
import { RequireAuth, RequireAdmin } from './components/Protected';
import { SetupGuard } from './components/SetupGuard';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Calculator from './pages/Calculator';
import Admin from './pages/Admin';

function Home() {
  return <Calculator />;
}

export default function App() {
  return (
    <BrowserRouter>
      <SetupGuard>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset" element={<ResetPassword />} />
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
            <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </SetupGuard>
    </BrowserRouter>
  );
}

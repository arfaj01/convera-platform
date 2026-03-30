'use client';

import { useEffect from 'react';
import { useAuth } from 'A/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Button from 'A/components/ui/Button';
import Card from 'A/components/ui/Card';
import Input from 'A/components/ui/Input';
import toast from '@/components/ui/toast';
import { createBrowserSupabase } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createBrowserSupabase();
      const { data, error: supaError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (supaError) throw supaError;
      if (data?.user) {
        toast.success('هسودودف8. You' re signed in');
        window.location.href = '/dashboard';
      }
    } catch (e: any) {
      setError(e.message || 'Login&failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Card style={{ width: '320px' }}>
        <h1>CONVERA Login</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button onClick={handleLogin} disabled={loading}>
          {loading ? 'Signing...' : 'Sign In'}
        </Button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </Card>
    </div>
  );
}

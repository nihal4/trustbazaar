import { useState } from 'react';
import { api } from '../api/client';

// FR-1–FR-9: email/phone + password auth. On success, store the JWT and
// redirect based on kycStatus (unverified users can browse/chat only).
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: POST /auth/login, store token, redirect on success.
    await api.post('/auth/login', { email, password }).catch(() => {
      /* TODO: surface a real error message */
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Log In</h1>
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
      </label>
      <label>
        Password
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
      </label>
      <button type="submit">Log In</button>
    </form>
  );
}

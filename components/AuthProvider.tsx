'use client';

import {
  createContext, useContext, useEffect, useState, useRef, useCallback,
} from 'react';
import { createBrowserSupabase, isSupabaseConfigured, releaseOrphanedLocks } from '@/lib/supabase';
import type { Profile, UserRole } from '@/lib/types';
import type { User } from '@supabase/supabase-js';

// ─── Constants ─────────────────────────────────────────────────────

/** Auto-logout after this many ms of inactivity */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;   // 30 minutes

/** Show warning banner this many ms before auto-logout */
const IDLE_WARN_BEFORE_MS = 5 * 60 * 1000; // warn at 25 minutes idle

// ─── Role Normalization ────────────────────────────────────────────
//
// The DB enum uses: director | admin | reviewer | consultant | contractor
// Older TypeScript code referenced: auditor (=admin), supervisor (=consultant)
// This map normalizes both old and new values to canonical DB role names.

const ROLE_NORMALIZE: Record<string, UserRole> = {
  // Old frontend names → canonical DB values
  auditor:    'admin',
  supervisor: 'consultant',
  // Canonical values map to themselves (identity, for safety)
  director:   'director',
  admin:      'admin',
  reviewer:   'reviewer',
  consultant: 'consultant',
  contractor: 'contractor',
};

function normalizeProfile(raw: Profile | null): Profile | null {
  if (!raw) return null;
  const canonical = ROLE_NORMALIZE[raw.role as string];
  return canonical ? { ...raw, role: canonical } : raw;
}

// ─── Context Type ──────────────────────────────────────────────────

interface AuthContextType {
  user:         User | null;
  profile:      Profile | null;
  loading:      boolean;
  /** Seconds remaining before auto-logout. null = idle warning not active */
  idleWarning:  number | null;
  /** Call to reset the idle timer (user chose "Stay logged in") */
  resetIdle:    () => void;
}

const AuthContext = createContext<AuthContextType>({
  user:        null,
  profile:     null,
  loading:     true,
  idleWarning: null,
  resetIdle:   () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ─── Provider ──────────────────────────────────────────────────────

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,         setUser]         = useState<User | null>(null);
  const [profile,      setProfile]      = useState<Profile | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [idleWarning,  setIdleWarning]  = useState<number | null>(null);

  const mounted      = useRef(true);
  const idleTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivity = useRef(Date.now());

  // ── Sign-out helper ─────────────────────────────────────────────
  const signOut = useCallback(async () => {
    if (!mounted.current) return;
    try {
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
    } finally {
      // Force redirect to login regardless of Supabase response
      window.location.replace('/login?reason=timeout');
    }
  }, []);

  // ── Clear all idle timers ───────────────────────────────────────
  const clearIdleTimers = useCallback(() => {
    if (idleTimer.current)    clearTimeout(idleTimer.current);
    if (warnTimer.current)    clearTimeout(warnTimer.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    idleTimer.current    = null;
    warnTimer.current    = null;
    countdownRef.current = null;
  }, []);

  // ── Start (or restart) idle timer ──────────────────────────────
  const resetIdle = useCallback(() => {
    if (!mounted.current) return;
    lastActivity.current = Date.now();
    setIdleWarning(null);
    clearIdleTimers();

    // Schedule warning
    warnTimer.current = setTimeout(() => {
      if (!mounted.current) return;
      // Start countdown in seconds
      let remaining = Math.round(IDLE_WARN_BEFORE_MS / 1000);
      setIdleWarning(remaining);
      countdownRef.current = setInterval(() => {
        if (!mounted.current) return;
        remaining -= 1;
        setIdleWarning(remaining);
        if (remaining <= 0) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
        }
      }, 1000);
    }, IDLE_TIMEOUT_MS - IDLE_WARN_BEFORE_MS);

    // Schedule auto-logout
    idleTimer.current = setTimeout(() => {
      if (!mounted.current) return;
      signOut();
    }, IDLE_TIMEOUT_MS);
  }, [clearIdleTimers, signOut]);

  // ── Activity event listeners (reset idle on any interaction) ───
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const EVENTS = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'] as const;

    // Throttle resets: only reset if >10s since last reset
    let lastReset = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset < 10_000) return;
      lastReset = now;
      resetIdle();
    };

    EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, onActivity));
    };
  }, [resetIdle]);

  // ── Core auth initialization ────────────────────────────────────
  useEffect(() => {
    mounted.current = true;

    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    async function init() {
      try {
        await releaseOrphanedLocks();

        const supabase = createBrowserSupabase();

        // Get session with a hard 5-second timeout
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<null>(resolve =>
          setTimeout(() => resolve(null), 5000),
        );

        const result = await Promise.race([sessionPromise, timeoutPromise]);
        const u = result && 'data' in result
          ? result.data.session?.user ?? null
          : null;

        if (!mounted.current) return;
        setUser(u);

        if (u) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', u.id)
            .single();

          if (!mounted.current) return;
          setProfile(normalizeProfile(data));

          // Start idle monitoring once logged in
          resetIdle();
        }
      } catch (err) {
        console.error('[AuthProvider] init error:', err);
      } finally {
        if (mounted.current) setLoading(false);
      }
    }

    init();

    // Auth state subscription (delayed to avoid lock contention)
    let subscription: { unsubscribe: () => void } | null = null;
    const setupListener = setTimeout(() => {
      if (!mounted.current) return;
      const supabase = createBrowserSupabase();
      const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (!mounted.current) return;
        const u = session?.user ?? null;
        setUser(u);

        if (u) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', u.id)
            .single();
          if (mounted.current) setProfile(normalizeProfile(profileData));
          resetIdle();
        } else {
          setProfile(null);
          clearIdleTimers();
          setIdleWarning(null);
        }
      });
      subscription = data.subscription;
    }, 1000);

    return () => {
      mounted.current = false;
      clearTimeout(setupListener);
      subscription?.unsubscribe();
      clearIdleTimers();
    };
  }, [resetIdle, clearIdleTimers]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, idleWarning, resetIdle }}>
      {children}
    </AuthContext.Provider>
  );
}

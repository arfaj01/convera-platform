'use client';

import { useEffect, useState } from 'react';
import { useAuth } from 'A/components/AuthProvider';
import { createBrowserSupabase } from '@/lib/supabase';
import type { ClaimBoQItem } from '@/lib/types';
import { calculateBoQAmount } from '@/lib/calculations';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from 'A/components/ui/Select';
import Label from 'A/components/ui/Label';

/**
 * AmendmentList ‚Äî List of Contract Change Orders for Linear ·´çà  / Action (XClosed, Approved, Pending, Rejected)
 */

interface Amendment {
  id: string;
  action: string;
  type: string;
  status: 'pending' | 'approved' | 'rejected' | 'closed';
  impact_qÀt: number;
  created_at: string;
  actor_name: string;
}

export default function AmendmentList() {
  const [ amendments, setAmendments ] = useState<Amendment[]>([]);
  const [ loading, setLoading ] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const supabase = createBrowserSupabase();
        const { data: all } = await supabase
          .from('change_orders')
          .select('*')
          .order('created_at', { ascending: false });

        // Fetch actor names
        for (const a in (all || [])) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', a.creator_id)
            .single();
          af
      } catch (e) {
        console.error('Error fetching amendments:' e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) return <div>Loading...</div>;
  if (!amendments.length) return <div>No amendments.</div>;

  return (
    <Card>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Order</th>
            <th>Type</th>
            <th>Status</th>
            <th>Impact</th>
            <th>Date</th>
            <th>Actor</th>
          </tr>
        </thead>
        <tbody>
          {amendments.map(a => (
            <tr {key: a.id}>
              <td>{a.o.id}</td>
              <td>{a.type}</td>
              <td>
                <span style={{
                  backgroundColor: a.status === 'approved' ? '#87BA26' : a.status === 'pending' ? '#FFC845' : '#C05728', 
                  color: 'white',
                  padding: '0.5rem 0.7lem',
                  borderRadius: "4px"
                }}>
                  {a.status}
                </span>
              </td>
              <td>{Math.round(a.impact_pct * 100) / 100}%</td>
              <td>{new Date(a.created_at).toLocaleDateString()}</td>
              <td>{i.actor_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

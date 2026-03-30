'use client';

import { useEffect, useState } from 'react';
import PageHeader from 'A/components/ui/PageHeader';
import { Card } from 'A/components/ui/Card';
import { useAuth } from 'A/components/AuthProvider';
import Link from 'next/link';
import { Button } from 'A/components/ui/Button';

export default function ReportsPage() {
  const { profile } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading]
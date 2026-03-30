'use client';

import { useState, useEffect } from 'react';
import type { ClaimWorkflowState, UserRole } from 'A/lib/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAUtNA
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Card, { CardBody } from '@/components/ui/Card';
import BOQTable from '@/components/claims/BOQTable';
import StaffGrid from '@/components/claims/StaffGrid';
import ClaimSummaryBox from '@/components/claims/ClaimSummary';
import InvoiceUpload from '@/components/claims/InvoiceUpload';
import { useToast } from '@/components/ui/Toast';
import { fetchContractorContracts } from '@/services/contracts';
import { fetchClaims, createClaim, submitClaim } from '@/services/claims';
import { uploadClaimDocument } from '@/services/documents';
import { loadBOQTemplate, loadStaffTemplate } from '@/services/templates';
import { getPreviousProgress } from '@/services/approvers';
import { calcClaimSummary, type BOQLineResult, type StaffLineResult } from '@/lib/calculations';
import { isConstructionContract } from '@/lib/constants';
import { friendlyError } from '@/lib/errors';
import type { ContractView, BOQFormItem, StaffFormItem } from '@/lib/types';

export default function NewClaimPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { showToast } = useToast();

  // ── Contract selection state ───────────────────────────────────
  const [availableContracts, setAvailableContracts] = useState<ContractView[]>([]);
  const [contract, setContract] = useState<ContractView | null>(null);
  const [contractsLoading, setContractsLoading] = useState(true);

  // ── Claim form state ───────────────────────────────────────────
  const [boqItems, setBoqItems] = useState<BOQFormItem[]>([]);
  const [staffItems, setStaffItems] = useState<StaffFormItem[]>([]);
  const [boqResults, setBoqResults] = useState<BOQLineResult[]>([]);
  const [staffResults, setStaffResults] = useState<StaffLineResult[]>([]);
  const [boqTotal, setBoqTotal] = useState(0);
  const [staffTotal, setStaffTotal] = useState(0);
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [refNo, setRefNo] = useState('');
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [nextClaimNo, setNextClaimNo] = useState(1);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [prevProgressValues, setPrevProgressValues] = useState<Record<number, number>>({});

  const hideStaff = contract ? isConstructionContract(contract.type as any) : false;

  // ── Step 1: Load available contractor contracts ────────────────
  useEffect(() => {
    if (!profile) return;

    async function loadContracts() {
      setContractsLoading(true);
      try {
        const contracts = await fetchContractorContracts(profile!.id);
        setAvailableContracts(contracts);

        // Auto-select if exactly one contract
        if (contracts.length === 1) {
          setContract(contracts[0]);
        }
      } catch (e) {
        console.warn('NewClaim loadContracts:', e);
        setAvailableContracts([]);
      } finally {
        setContractsLoading(false);
      }
    }
    loadContracts();
  }, [profile]);

  // ── Step 2: Load BOQ/Staff templates when contract is selected ─
  useEffect(() => {
    if (!contract) {
      setBoqItems([]);
      setStaffItems([]);
      setBoqResults([]);
      setStaffResults([]);
      setBoqTotal(0);
      setStaffTotal(0);
      setLoading(false);
      return;
    }

    async function loadTemplates() {
      setLoading(true);
      try {
        const promises: Promise<any>[] = [loadBOQTemplate(contract!.id)];
        if (!isConstructionContract(contract!.type as any)) {
          promises.push(loadStaffTemplate(contract!.id));
        }
        const results = await Promise.all(promises);
        setBoqItems(results[0]);
        if (results[1]) setStaffItems(results[1]);
        else setStaffItems([]);

        // Auto-load prev_progress from approved claims (Migration 040)
        try {
          const prevResult = await getPreviousProgress(contract!.id);
          if (prevResult.success && prevResult.data) {
            setPrevProgressValues(prevResult.data);
          } else {
            setPrevProgressValues({});
          }
        } catch (e) {
          console.warn('NewClaim loadPrevProgress:', e);
          setPrevProgressValues({});
        }
      } catch (e) {
        console.warn('NewClaim loadTemplates:', e);
      } finally {
        setLoading(false);
      }
    }
    loadTemplates();
  }, [contract]);

  // ── Load next claim number ─────────────────────────────────────
  useEffect(() => {
    fetchClaims()
      .then(claims => setNextClaimNo((Math.max(0, ...claims.map(c => c.no)) || 0) + 1))
      .catch(() => {});
  }, []);

  // ── Contract selection handler ─────────────────────────────────
  const handleContractSelect = useCallback((contractId: string) => {
    const selected = availableContracts.find(c => c.id === contractId);
    if (selected) {
      setContract(selected);
      // Reset form state
      setBoqResults([]);
      setStaffResults([]);
      setBoqTotal(0);
      setStaffTotal(0);
      setPeriodFrom('');
      setPeriodTo('');
      setRefNo('');
      setInvoiceFile(null);
      setValidationErrors([]);
    }
  }, [availableContracts]);

  const [boqHasErrors, setBoqHasErrors] = useState(false);

  const handleBoqChange = useCallback((results: BOQLineResult[], total: number, hasErrors?: boolean) => {
    setBoqResults(results);
    setBoqTotal(total);
    setBoqHasErrors(!!hasErrors);
    setValidationErrors([]);
  }, []);

  const handleStaffChange = useCallback((results: StaffLineResult[], total: number) => {
    setStaffResults(results);
    setStaffTotal(total);
    setValidationErrors([]);
  }, []);

  const effectiveStaffTotal = hideStaff ? 0 : staffTotal;
  const summary = calcClaimSummary(boqTotal, effectiveStaffTotal);

  const validate = (asDraft: boolean): string[] => {
    const errors: string[] = [];
    if (!contract) errors.push('يجب تحديد العقد');
    if (!periodFrom) errors.push('يجب تحديد تاريخ بداية الفترة');
    if (!periodTo) errors.push('يجب تحديد تاريخ نهاية الفترة');
    if (periodFrom && periodTo && periodFrom > periodTo) {
      errors.push('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }
    if (!refNo.trim()) errors.push('يجب إدخال الرقم المرجعي (اعتماد)');
    const hasCurrQty = boqResults.some(r => r.currQty > 0);
    const hasStaffProgress = !hideStaff && staffResults.some(r => r.workingDays > 0);
    if (!hasCurrQty && !hasStaffProgress) {
      errors.push('يجب إدخال الكميات الحالية (جاري) لبند واحد على الأقل');
    }
    if (boqHasErrors) {
      errors.push('يوجد تجاوز في كميات بنود الأعمال — يرجى تصحيح القيم المظللة بالأحمر');
    }
    if (!asDraft && !invoiceFile) {
      errors.push('لا يمكن تقديم المطالبة المالية بدون إرفاق الفاتورة المعتمدة');
    }
    return errors;
  };

  const buildPayload = () => {
    const boqRows = boqResults
      .filter(r => r.currQty > 0)
      .map(r => {
        const item = boqItems.find(i => i.id === r.itemId)!;
        return {
          item_no: r.itemId,
          description: item.name,
          description_ar: item.name,
          unit: item.unit || 'عدد',
          unit_price: item.price,
          prev_progress: r.prevQty,
          curr_progress: r.currQty,
          period_amount: r.periodAmount,
          performance_pct: 100,
          after_perf: r.afterPerf,
          contractual_qty: item.contractualQty || 1,
          cumulative: r.cumulativeQty,
          requires_variation: false,
        };
      });

    const staffRows = hideStaff ? [] : staffResults
      .filter(r => r.workingDays > 0 || r.overtimeHours > 0)
      .map(r => {
        const item = staffItems.find(i => i.id === r.itemId)!;
        return {
          item_no: r.itemId,
          position: item.name,
          position_ar: item.name,
          monthly_rate: item.price,
          contract_months: item.months,
          working_days: r.workingDays,
          overtime_hours: r.overtimeHours,
          basic_amount: r.basicAmount,
          extra_amount: r.extraAmount,
          total_amount: r.totalAmount,
          performance_pct: 100,
          after_perf: r.afterPerf,
        };
      });

    const claimType = staffRows.length > 0 && boqRows.length > 0
      ? 'mixed' as const
      : staffRows.length > 0
        ? 'staff_only' as const
        : 'boq_only' as const;

    return { boqRows, staffRows, claimType };
  };

  const handleSave = async (asDraft: boolean) => {
    if (!profile || !contract) {
      showToast('يجب تسجيل الدخول وتحديد العقد', 'error');
      return;
    }

    if (!asDraft) {
      const errors = validate(false);
      if (errors.length > 0) {
        setValidationErrors(errors);
        showToast(errors[0], 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      const { boqRows, staffRows, claimType } = buildPayload();

      const claim = await createClaim({
        contractId: contract.id,
        claimNo: nextClaimNo,
        periodFrom: periodFrom || null,
        periodTo: periodTo || null,
        referenceNo: refNo || null,
        boqAmount: boqTotal,
        staffAmount: effectiveStaffTotal,
        retentionAmount: 0,
        vatAmount: summary.vatAmount,
        claimType,
        submittedBy: profile.id,
        boqRows,
        staffRows,
        status: 'draft',
      });

      const claimId = claim?.data?.id;
      if (!claimId) throw new Error('فشل في إنشاء المطالبة');

      if (invoiceFile && claimId) {
        try {
          await uploadClaimDocument(claimId, invoiceFile, 'invoice', profile.id);
        } catch (uploadErr) {
          console.error('Invoice upload failed:', uploadErr);
          showToast('تم إنشاء المسودة لكن فشل رفع الفاتورة. يرجى رفعها من صفحة المطالبة.', 'error');
        }
      }

      if (asDraft) {
        showToast(`تم حفظ المسودة #${nextClaimNo} بنجاح`, 'ok');
        setTimeout(() => router.push('/claims'), 1000);
        return;
      }

      const submitResult = await submitClaim(claimId);
      if (!submitResult.success) {
        showToast(submitResult.error || 'فشل في تقديم المطالبة — تم حفظها كمسودة', 'error');
        setTimeout(() => router.push(`/claims/${claimId}`), 1500);
        return;
      }

      showToast(`تم تقديم المطالبة #${nextClaimNo} بنجاح`, 'ok');
      setTimeout(() => router.push('/claims'), 1000);
    } catch (e) {
      showToast(friendlyError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────
  if (contractsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-400 animate-pulse">جاري تحميل العقود...</p>
      </div>
    );
  }

  // ── No contracts available ─────────────────────────────────────
  if (availableContracts.length === 0) {
    return (
      <>
        <PageHeader title="مطالبة مالية جديدة" subtitle="" />
        <Card className="mb-3">
          <CardBody>
            <div className="text-center py-10">
              <div className="text-4xl mb-3">📋</div>
              <h3 className="text-base font-bold text-[#045859] mb-2">
                لا توجد عقود مرتبطة بحسابك
              </h3>
              <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
                لتقديم مطالبة مالية، يجب أن تكون مرتبطاً بعقد نشط بصفة مقاول.
                يرجى التواصل مع مدير الإدارة لربط حسابك بالعقد المناسب.
              </p>
              <Button variant="outline" onClick={() => router.push('/claims')}>
                العودة لقائمة المطالبات
              </Button>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  const hasErrors = validationErrors.length > 0;
  const invoiceMissing = hasErrors && !invoiceFile && validationErrors.some(e => e.includes('الفاتورة'));
  const showContractSelector = availableContracts.length > 1;
  const contractSelected = !!contract;

  // Step numbering adjusts based on whether contract selector is shown
  const stepContract = showContractSelector ? 1 : -1;
  const stepPeriod   = showContractSelector ? 2 : 1;
  const stepBoq      = showContractSelector ? 3 : 2;
  const stepStaff    = hideStaff ? -1 : (showContractSelector ? 4 : 3);
  const stepInvoice  = hideStaff
    ? (showContractSelector ? 4 : 3)
    : (showContractSelector ? 5 : 4);

  return (
    <>
      <PageHeader title="مطالبة مالية جديدة" subtitle={contract?.title || 'اختر العقد'} />

      {hasErrors && (
        <div className="mb-3 p-3 bg-red/5 border border-red/20 rounded">
          <div className="text-[0.78rem] font-bold text-red mb-1">يرجى تصحيح الأخطاء التالية:</div>
          <ul className="list-disc list-inside text-[0.75rem] text-red/80 space-y-0.5">
            {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      {/* ── Contract Selector (shown when user has multiple contracts) ── */}
      {showContractSelector && (
        <Card className="mb-3">
          <div className="p-3 bg-teal-ultra border-b border-gray-100 rounded-t flex items-center gap-2">
            <div className="w-[22px] h-[22px] rounded-full bg-teal text-white flex items-center justify-center text-[0.65rem] font-extrabold flex-shrink-0">{stepContract}</div>
            <h4 className="text-[0.82rem] font-bold text-teal-dark">اختيار العقد</h4>
          </div>
          <CardBody>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">
              العقد <span className="text-red">*</span>
            </label>
            <p className="text-[0.68rem] text-gray-400 mb-2">
              لديك {availableContracts.length} عقود مرتبطة بحسابك — اختر العقد لتقديم المطالبة عليه.
            </p>
            <div className="space-y-2">
              {availableContracts.map(c => {
                const isSelected = contract?.id === c.id;
                return (
                  <label
                    key={c.id}
                    className={`
                      flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
                      ${isSelected
                        ? 'border-[#045859] bg-[#E8F4F4] shadow-sm'
                        : 'border-gray-200 hover:border-[#045859]/30 bg-white'}
                    `}
                  >
                    <input
                      type="radio"
                      name="contract"
                      value={c.id}
                      checked={isSelected}
                      onChange={() => handleContractSelect(c.id)}
                      className="accent-[#045859] flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.82rem] font-bold text-[#045859] truncate">
                        {c.title}
                      </div>
                      <div className="flex gap-3 text-[0.68rem] text-gray-400 mt-0.5">
                        <span>رقم العقد: {c.no}</span>
                        <span>القيمة: {c.value.toLocaleString('ar-SA')} ريال</span>
                        <span>{c.type}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="text-[#87BA26] text-lg flex-shrink-0">✓</span>
                    )}
                  </label>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Remaining form (only shown after contract is selected) ── */}
      {contractSelected ? (
        <>
          {/* Step: Period + Reference */}
          <Card className="mb-3">
            <div className="p-3 bg-teal-ultra border-b border-gray-100 rounded-t flex items-center gap-2">
              <div className="w-[22px] h-[22px] rounded-full bg-teal text-white flex items-center justify-center text-[0.65rem] font-extrabold flex-shrink-0">{stepPeriod}</div>
              <h4 className="text-[0.82rem] font-bold text-teal-dark">بيانات الفترة</h4>
            </div>
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">الفترة من <span className="text-red">*</span></label>
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={e => { setPeriodFrom(e.target.value); setValidationErrors([]); }}
                    className={`w-full px-2.5 py-2 border-[1.5px] ${!periodFrom && hasErrors ? 'border-red/40' : 'border-gray-100'} rounded-sm text-sm font-sans bg-gray-50 focus:border-teal focus:outline-none`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">الفترة إلى <span className="text-red">*</span></label>
                  <input
                    type="date"
                    value={periodTo}
                    onChange={e => { setPeriodTo(e.target.value); setValidationErrors([]); }}
                    className={`w-full px-2.5 py-2 border-[1.5px] ${!periodTo && hasErrors ? 'border-red/40' : 'border-gray-100'} rounded-sm text-sm font-sans bg-gray-50 focus:border-teal focus:outline-none`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">الرقم المرجعي (اعتماد) <span className="text-red">*</span></label>
                  <input
                    type="text"
                    value={refNo}
                    onChange={e => { setRefNo(e.target.value); setValidationErrors([]); }}
                    placeholder="مطلوب"
                    className={`w-full px-2.5 py-2 border-[1.5px] ${!refNo.trim() && hasErrors ? 'border-red/40' : 'border-gray-100'} rounded-sm text-sm font-sans bg-gray-50 text-right focus:border-teal focus:outline-none`}
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Step: BOQ Items */}
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-sm text-gray-400 animate-pulse">جاري تحميل بنود العقد...</p>
            </div>
          ) : (
            <>
              {boqItems.length > 0 && (
                <Card className="mb-3">
                  <div className="p-3 bg-teal-ultra border-b border-gray-100 rounded-t flex items-center gap-2">
                    <div className="w-[22px] h-[22px] rounded-full bg-teal text-white flex items-center justify-center text-[0.65rem] font-extrabold flex-shrink-0">{stepBoq}</div>
                    <h4 className="text-[0.82rem] font-bold text-teal-dark">بنود العقد</h4>
                  </div>
                  <CardBody className="p-0">
                    <BOQTable items={boqItems} onChange={handleBoqChange} prevProgressValues={prevProgressValues} />
                  </CardBody>
                </Card>
              )}

              {/* Step: Staff (hidden for construction) */}
              {!hideStaff && staffItems.length > 0 && (
                <Card className="mb-3">
                  <div className="p-3 bg-teal-ultra border-b border-gray-100 rounded-t flex items-center gap-2">
                    <div className="w-[22px] h-[22px] rounded-full bg-teal text-white flex items-center justify-center text-[0.65rem] font-extrabold flex-shrink-0">{stepStaff}</div>
                    <h4 className="text-[0.82rem] font-bold text-teal-dark">الكوادر</h4>
                  </div>
                  <CardBody className="p-0">
                    <StaffGrid items={staffItems} onChange={handleStaffChange} />
                  </CardBody>
                </Card>
              )}

              {/* Step: Invoice Upload */}
              <Card className="mb-3">
                <div className="p-3 bg-teal-ultra border-b border-gray-100 rounded-t flex items-center gap-2">
                  <div className="w-[22px] h-[22px] rounded-full bg-teal text-white flex items-center justify-center text-[0.65rem] font-extrabold flex-shrink-0">{stepInvoice}</div>
                  <h4 className="text-[0.82rem] font-bold text-teal-dark">المستندات المطلوبة</h4>
                </div>
                <CardBody>
                  <InvoiceUpload
                    file={invoiceFile}
                    onFileSelect={(f) => { setInvoiceFile(f); setValidationErrors([]); }}
                    hasError={invoiceMissing}
                  />
                  <div className="mt-2 text-[0.65rem] text-gray-400">
                    يجب إرفاق الفاتورة المعتمدة من الاستشاري المشرف قبل تقديم المطالبة المالية.
                    يمكنك حفظ المسودة بدون إرفاق.
                  </div>
                </CardBody>
              </Card>

              {/* Summary + Submit */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2">
                  <ClaimSummaryBox summary={summary} hideStaff={hideStaff} />
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <Button
                    variant="teal"
                    icon="📤"
                    onClick={() => handleSave(false)}
                    disabled={submitting || (boqTotal === 0 && effectiveStaffTotal === 0)}
                    className={`w-full justify-center py-3 ${submitting ? 'opacity-70 cursor-not-allowed pointer-events-none' : ''}`}
                  >
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        جاري التقديم...
                      </span>
                    ) : 'تقديم المطالبة'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleSave(true)}
                    disabled={submitting}
                    className="w-full justify-center"
                  >
                    حفظ كمسودة
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => router.push('/claims')}
                    className="w-full justify-center"
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        /* Prompt to select a contract */
        <Card className="mb-3">
          <CardBody>
            <div className="text-center py-8 text-gray-400">
              <div className="text-3xl mb-2">👆</div>
              <p className="text-sm">اختر العقد أعلاه لبدء إعداد المطالبة المالية</p>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

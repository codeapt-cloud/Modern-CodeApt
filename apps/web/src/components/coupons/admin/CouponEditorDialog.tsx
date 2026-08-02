/**
 * Coupon create/edit dialog. Fields adapt to the discount type: a percentage
 * (integer 1–100) or a fixed amount entered in rupees and stored to the paisa.
 * Scope is a subject picker with a "Global" option (null). Validity dates are
 * date-only inputs mapped to day-start / day-end ISO. Server errors (CODE_TAKEN
 * etc.) surface inline.
 */
import {
  CouponDiscountType,
  type AdminCoupon,
  type AdminCouponUpsert,
} from "@codeapt/shared";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import {
  paiseToRupeeInput,
  rupeesToPaise,
} from "../../../lib/curriculum-admin-ui.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { FormField } from "../../ui/form-field.js";
import { Input } from "../../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Switch } from "../../ui/switch.js";
import { useToast } from "../../ui/toast.js";

const GLOBAL_SCOPE = "__global__";

interface CouponFormValues {
  code: string;
  discountType: CouponDiscountType;
  percentValue: number;
  fixedRupees: number;
  subjectId: string; // "" = global
  validFrom: string; // yyyy-mm-dd or ""
  validTo: string;
  usageLimit: string; // "" = unlimited
  perUserLimit: number;
  minOrderRupees: number;
  active: boolean;
}

function toDefaults(c: AdminCoupon | null): CouponFormValues {
  const isFixed = c?.discountType === CouponDiscountType.FIXED;
  return {
    code: c?.code ?? "",
    discountType: c?.discountType ?? CouponDiscountType.PERCENTAGE,
    percentValue: c && !isFixed ? c.discountValue : 10,
    fixedRupees: c && isFixed ? paiseToRupeeInput(c.discountValue) : 0,
    subjectId: c?.subjectId ?? "",
    validFrom: c?.validFrom ? c.validFrom.slice(0, 10) : "",
    validTo: c?.validTo ? c.validTo.slice(0, 10) : "",
    usageLimit: c?.usageLimit != null ? String(c.usageLimit) : "",
    perUserLimit: c?.perUserLimit ?? 1,
    minOrderRupees: c ? paiseToRupeeInput(c.minOrderPaise) : 0,
    active: c?.active ?? true,
  };
}

function toPayload(v: CouponFormValues): AdminCouponUpsert {
  const usageTrim = v.usageLimit.trim();
  const common = {
    code: v.code.trim(),
    active: v.active,
    validFrom: v.validFrom
      ? new Date(`${v.validFrom}T00:00:00.000Z`).toISOString()
      : null,
    validTo: v.validTo
      ? new Date(`${v.validTo}T23:59:59.000Z`).toISOString()
      : null,
    usageLimit: usageTrim ? Math.max(1, Math.trunc(Number(usageTrim))) : null,
    perUserLimit: Math.max(1, Math.trunc(v.perUserLimit) || 1),
    minOrderPaise: rupeesToPaise(v.minOrderRupees),
    subjectId: v.subjectId ? v.subjectId : null,
  };
  return v.discountType === CouponDiscountType.FIXED
    ? {
        discountType: CouponDiscountType.FIXED,
        discountValue: rupeesToPaise(v.fixedRupees),
        ...common,
      }
    : {
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: Math.min(100, Math.max(1, Math.trunc(v.percentValue) || 1)),
        ...common,
      };
}

export interface CouponEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; an AdminCoupon → edit. */
  initial: AdminCoupon | null;
  onSaved: () => void;
}

export function CouponEditorDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: CouponEditorDialogProps) {
  const { toast } = useToast();
  const [formError, setFormError] = useState("");
  const { data: subjectsData } = useQuery(
    () => api.adminCurriculum.subjects.list(),
    [],
  );
  const subjects = subjectsData?.items ?? [];

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CouponFormValues>({ defaultValues: toDefaults(initial) });

  const discountType = watch("discountType");

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    const payload = toPayload(values);
    try {
      if (initial) {
        await api.adminCoupons.update(initial.id, payload);
      } else {
        await api.adminCoupons.create(payload);
      }
      toast({
        variant: "success",
        title: initial ? "Coupon updated" : "Coupon created",
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setFormError(parseApiError(err).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit coupon" : "New coupon"}</DialogTitle>
          <DialogDescription>
            Percentage or fixed discount, optionally scoped to one course, with a
            validity window and usage caps.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Code" required error={errors.code?.message}>
              <Input
                placeholder="SAVE20"
                {...register("code", { required: "Code is required" })}
              />
            </FormField>
            <FormField label="Discount type">
              <Controller
                control={control}
                name="discountType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CouponDiscountType.PERCENTAGE}>
                        Percentage (%)
                      </SelectItem>
                      <SelectItem value={CouponDiscountType.FIXED}>
                        Fixed amount (₹)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {discountType === CouponDiscountType.FIXED ? (
              <FormField label="Amount off (₹)" hint="Flat discount in rupees.">
                <Input
                  type="number"
                  min={1}
                  step="0.01"
                  {...register("fixedRupees", { valueAsNumber: true })}
                />
              </FormField>
            ) : (
              <FormField label="Percent off" hint="1–100.">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  {...register("percentValue", { valueAsNumber: true })}
                />
              </FormField>
            )}
            <FormField label="Scope" hint="Limit to one course, or keep global.">
              <Controller
                control={control}
                name="subjectId"
                render={({ field }) => (
                  <Select
                    value={field.value ? field.value : GLOBAL_SCOPE}
                    onValueChange={(v) =>
                      field.onChange(v === GLOBAL_SCOPE ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GLOBAL_SCOPE}>
                        Global (all courses)
                      </SelectItem>
                      {subjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Valid from" hint="Blank = no start bound.">
              <Input type="date" {...register("validFrom")} />
            </FormField>
            <FormField label="Valid to" hint="Blank = no end bound.">
              <Input type="date" {...register("validTo")} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Usage limit" hint="Blank = unlimited.">
              <Input type="number" min={1} {...register("usageLimit")} />
            </FormField>
            <FormField label="Per-user limit">
              <Input
                type="number"
                min={1}
                {...register("perUserLimit", { valueAsNumber: true })}
              />
            </FormField>
            <FormField label="Min order (₹)" hint="0 = none.">
              <Input
                type="number"
                min={0}
                step="0.01"
                {...register("minOrderRupees", { valueAsNumber: true })}
              />
            </FormField>
          </div>

          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <label className="flex items-center gap-3">
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <span className="text-sm text-ink">
                  Active (redeemable at checkout)
                </span>
              </label>
            )}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {initial ? "Save changes" : "Create coupon"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

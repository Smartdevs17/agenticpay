"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Sparkles } from "lucide-react";

export interface ABTestVariantForm {
  id: string;
  name: string;
  amount: number;
  description?: string;
  accentColor?: string;
  ctaText?: string;
  weight: number;
}

interface ABTestConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  linkId: string;
  initialVariants?: ABTestVariantForm[];
  onSave: (linkId: string, variants: ABTestVariantForm[]) => Promise<void>;
}

export function ABTestConfigModal({
  isOpen,
  onClose,
  linkId,
  initialVariants = [],
  onSave,
}: ABTestConfigModalProps) {
  const [variants, setVariants] = useState<ABTestVariantForm[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialVariants && initialVariants.length > 0) {
      setVariants(initialVariants);
    } else {
      setVariants([
        { id: "var_a", name: "Variant A (Control)", amount: 50, weight: 50, ctaText: "Pay Now" },
        { id: "var_b", name: "Variant B (Promo)", amount: 45, weight: 50, ctaText: "Claim Discount" },
      ]);
    }
  }, [initialVariants, isOpen]);

  const handleAddVariant = () => {
    const id = `var_${Date.now().toString(36)}`;
    setVariants((prev) => [
      ...prev,
      { id, name: `Variant ${String.fromCharCode(65 + prev.length)}`, amount: 50, weight: 50, ctaText: "Pay Now" },
    ]);
  };

  const handleRemoveVariant = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: keyof ABTestVariantForm, value: any) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(linkId, variants);
      onClose();
    } catch (err) {
      console.error("Failed to save A/B testing variants", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-500" /> A/B Testing Configuration
          </DialogTitle>
          <DialogDescription>
            Create price, CTA, or brand variants to test which offer converts payers at the highest rate.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {variants.map((v, idx) => (
            <div
              key={v.id}
              className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3 bg-gray-50/50 dark:bg-gray-900/40 relative"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Option #{idx + 1}
                </span>
                {variants.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-500 hover:text-red-700"
                    onClick={() => handleRemoveVariant(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium">Variant Name</Label>
                  <Input
                    value={v.name}
                    onChange={(e) => handleChange(idx, "name", e.target.value)}
                    placeholder="e.g. Discount Price"
                    className="mt-1 text-sm"
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Price Amount ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={v.amount}
                    onChange={(e) => handleChange(idx, "amount", parseFloat(e.target.value) || 0)}
                    className="mt-1 text-sm"
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">CTA Button Label</Label>
                  <Input
                    value={v.ctaText || ""}
                    onChange={(e) => handleChange(idx, "ctaText", e.target.value)}
                    placeholder="e.g. Claim Offer"
                    className="mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Traffic Weight Split (0-100)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={v.weight}
                    onChange={(e) => handleChange(idx, "weight", parseInt(e.target.value) || 50)}
                    className="mt-1 text-sm"
                    required
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={handleAddVariant}
            className="w-full flex items-center justify-center gap-2 border-dashed"
          >
            <Plus className="h-4 w-4" /> Add Variant
          </Button>

          <DialogFooter className="pt-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving Variants..." : "Save A/B Testing Configuration"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

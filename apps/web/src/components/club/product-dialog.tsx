'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Product } from '@packages/validation';
import { useOpsMutation } from '@/hooks/use-ops';
import { CheckField, Field, FormDialog, errorText, fromPaise, toPaise } from '@/components/club/form-dialog';
import { SelectBox } from '@/components/club/ops-bits';
import { ImageUploader } from '@/components/club/image-uploader';
import { categoryOptions, useCategories } from '@/hooks/use-categories';

/** Create (`product` null) or edit a shop product. Stock changes go through the restock or adjust dialog. */
export function ProductDialog({
  product,
  open,
  onClose,
  onDeleteRequest,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onDeleteRequest?: (product: Product) => void;
}) {
  const editing = Boolean(product);
  const categories = useCategories('PRODUCT');
  const [form, setForm] = useState({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    category: product?.category ?? 'ACCESSORY',
    price: product ? fromPaise(product.pricePaise) : '',
    stock: '0',
    reorder: String(product?.reorderLevel ?? 5),
    discountable: product?.discountPct !== undefined ? true : true,
    isActive: product?.isActive ?? true,
  });
  const [imageUrl, setImageUrl] = useState<string | null>(product?.imageUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<Product, object>('post', ['products', 'reports'], () => '/products');
  const update = useOpsMutation<Product, { id: string; [key: string]: unknown }>('put', ['products', 'reports'], (v) => `/products/${v.id}`);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: event.target.value });

  async function submit() {
    setError(null);
    const pricePaise = toPaise(form.price);
    const reorderLevel = Number(form.reorder);
    const stockQty = Number(form.stock);

    if (!form.name.trim()) return setError('Enter a product name.');
    if (!form.sku.trim()) return setError('Enter a SKU, the short code used on the shelf label.');
    if (!Number.isFinite(pricePaise)) return setError('Enter the price in rupees, for example 1499 or 1499.50.');
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return setError('The reorder level must be a whole number, zero or more.');
    if (!editing && (!Number.isInteger(stockQty) || stockQty < 0)) return setError('Opening stock must be a whole number, zero or more.');

    try {
      const base = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        category: form.category,
        pricePaise,
        reorderLevel,
        ...(editing || imageUrl ? { imageUrl } : {}),
      };
      if (product) {
        await update.mutateAsync({ id: product.id, ...base, isActive: form.isActive });
      } else {
        await create.mutateAsync({ ...base, stockQty, discountable: form.discountable });
      }
      toast.success(editing ? `${form.name.trim()} updated` : `${form.name.trim()} added`);
      onClose();
    } catch (caught) {
      setError(errorText(caught, 'Could not save the product.'));
    }
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${product?.name}` : 'New product'}
      description={
        editing
          ? 'Stock changes go through Restock or Adjust stock, ensuring an audit log of each movement.'
          : 'Add something to sell at the counter and online shop.'
      }
      onSubmit={submit}
      submitLabel={editing ? 'Save changes' : 'Add product'}
      pending={create.isPending || update.isPending}
      error={error}
    >
      <Field id="prod-name" label="Name" value={form.name} onChange={set('name')} autoComplete="off" />

      <ImageUploader kind="product" label="Product photo" value={imageUrl} onChange={setImageUrl} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="prod-sku" label="SKU" value={form.sku} onChange={set('sku')} autoComplete="off" />
        <SelectBox
          id="prod-category"
          label="Category"
          value={form.category}
          onChange={(value) => setForm({ ...form, category: value as typeof form.category })}
          options={categoryOptions(categories.data, form.category)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="prod-price" label="Price (₹)" inputMode="decimal" value={form.price} onChange={set('price')} />
        {!editing && <Field id="prod-stock" label="Opening stock" inputMode="numeric" value={form.stock} onChange={set('stock')} />}
        <Field id="prod-reorder" label="Reorder level" inputMode="numeric" value={form.reorder} onChange={set('reorder')} hint="Flagged as low stock at or below this." />
      </div>

      <CheckField
        id="prod-discountable"
        label="Members get their club discount on this"
        checked={form.discountable}
        onChange={(value) => setForm({ ...form, discountable: value })}
      />

      {editing && (
        <div className="flex items-center justify-between border-t pt-3">
          <CheckField
            id="prod-active"
            label="Product is active in catalogue"
            checked={form.isActive}
            onChange={(value) => setForm({ ...form, isActive: value })}
            hint="Deactivate to hide from counter and online sales without losing order records."
          />

          {onDeleteRequest && product && (
            <button
              type="button"
              className="text-xs font-medium text-destructive hover:underline"
              onClick={() => {
                onClose();
                onDeleteRequest(product);
              }}
            >
              Delete product…
            </button>
          )}
        </div>
      )}
    </FormDialog>
  );
}

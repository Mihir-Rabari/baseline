'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProductCategory, Product } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useShopProducts, useShopQuote } from '@/hooks/use-shop';
import { useShopCart } from '@/hooks/use-shop-cart';
import { shopApi } from '@/lib/shop-api';
import { Cart } from '@/components/club/cart';
import { Money } from '@/components/club/money';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
export default function ShopPage() {
  const { user, hasPermission } = useAuth(); const canOrder = Boolean(user) && hasPermission('orders:create:self'); const signedCatalogue = Boolean(user) && (hasPermission('orders:read:self') || hasPermission('products:read'));
  const [category, setCategory] = useState('ALL'); const [q, setQ] = useState(''); const [fulfilment, setFulfilment] = useState<'PICKUP' | 'DELIVERY'>('PICKUP'); const [address, setAddress] = useState('');
  const products = useShopProducts({ limit: 100, q, category: category === 'ALL' ? undefined : category as ProductCategory }, signedCatalogue ? 'member' : 'public'); const cart = useShopCart(); const client = useQueryClient();
  const items = cart.lines.map((line) => ({ productId: line.product.id, qty: line.qty })); const quote = useShopQuote({ items, fulfilment }, canOrder, true);
  const order = useMutation({ mutationFn: () => shopApi.online({ items, fulfilment, deliveryAddress: fulfilment === 'DELIVERY' ? address : undefined }), onSuccess: (created) => { toast.success(`Order ${created.orderNumber} placed`); cart.clear(); client.invalidateQueries({ queryKey: ['products'] }); client.invalidateQueries({ queryKey: ['orders'] }); }, onError: (error) => toast.error(error.message) });
  return <div className="container space-y-6 py-10"><div className="space-y-2"><h1 className="text-2xl font-semibold">Club shop</h1><p className="text-muted-foreground">Equipment and essentials for your next game.</p></div><Tabs value={category} onValueChange={setCategory}><TabsList className="h-auto flex-wrap justify-start">{[['ALL','All'],['RACKET','Rackets'],['BALL','Balls'],['SHOE','Shoes'],['ACCESSORY','Accessories'],['APPAREL','Apparel']].map(([value,label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList></Tabs><div className="space-y-2"><Label htmlFor="shop-search">Search products</Label><Input id="shop-search" placeholder="Search by product name" value={q} onChange={(event) => setQ(event.target.value)} /></div>
    <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]"><section>{products.error ? <PageError error={products.error} onRetry={() => { products.refetch(); }} /> : products.isPending ? <div role="status" aria-label="Loading products"><Skeleton className="h-80" /></div> : !products.data?.data.length ? <EmptyState title="No products match" description="Try another product or category." /> : <ul className="grid gap-4 sm:grid-cols-2">{products.data.data.map((p) => <li key={p.id} className="space-y-3 rounded-md border p-4"><h2 className="font-medium">{p.name}</h2><Money paise={'yourPricePaise' in p ? Number(p.yourPricePaise) : p.pricePaise} />{'discountPct' in p && Number(p.discountPct) > 0 && <p className="text-xs text-muted-foreground">Member price</p>}{!p.inStock ? <Badge variant="destructive">Sold out</Badge> : 'stockQty' in p && (p as Product).stockQty === 1 ? <Badge variant="warning">Only 1 left</Badge> : null}<div><Button variant="outline" disabled={!p.inStock || order.isPending} onClick={() => cart.add(p)} aria-label={`Add ${p.name}`}>Add</Button></div></li>)}</ul>}</section>
    <div className="space-y-4 rounded-md border p-4"><Cart lines={cart.lines} onQuantity={cart.quantity} quote={quote.data} error={quote.error || order.error} disabled={order.isPending} />{!user ? <Link className={buttonVariants()} href="/login">Sign in to order</Link> : !canOrder ? <p className="text-sm text-muted-foreground">A member account is required to order online.</p> : <><Label htmlFor="shop-fulfilment">Fulfilment</Label><Select value={fulfilment} onValueChange={(value) => setFulfilment(value as 'PICKUP' | 'DELIVERY')}><SelectTrigger id="shop-fulfilment"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PICKUP">Pickup</SelectItem><SelectItem value="DELIVERY">Delivery</SelectItem></SelectContent></Select>{fulfilment === 'DELIVERY' && <><Label htmlFor="delivery-address">Delivery address</Label><Input id="delivery-address" placeholder="House, street, area, city" aria-required="true" value={address} maxLength={500} onChange={(event) => setAddress(event.target.value)} /></>}<Button disabled={order.isPending || !items.length || quote.isPending || quote.isFetching || Boolean(quote.error) || quote.data?.items.some((line) => !line.inStock) || (fulfilment === 'DELIVERY' && !address.trim())} onClick={() => order.mutate()}>{order.isPending ? 'Placing order…' : 'Place order'}</Button></>}</div></div>
  </div>;
}

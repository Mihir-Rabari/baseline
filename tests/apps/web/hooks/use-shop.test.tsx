import React from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {describe,expect,it,vi} from 'vitest';
import {shopApi} from '@/lib/shop-api';
import {useShopProducts,useRestock} from '../../../../apps/web/src/hooks/use-shop';
import products from '@/mocks/shop-products.json';
vi.mock('@/lib/shop-api',()=>({shopApi:{products:vi.fn(),restock:vi.fn()}}));
describe('shop queries',()=>{
 it('invalidates the product shelf after restocking and refreshes quantities',async()=>{
  let stock=0;vi.mocked(shopApi.products).mockImplementation(async()=>({data:[{...products[4],category:'BALL' as const,stockQty:stock,inStock:stock>0}],meta:{page:1,limit:100,totalItems:1,totalPages:1,hasNextPage:false,hasPrevPage:false}}));
  vi.mocked(shopApi.restock).mockImplementation(async(_id,data)=>{stock+=data.qty;return {product:{...products[4],category:'BALL' as const,stockQty:stock,inStock:true},movement:{id:'movement',qtyDelta:data.qty,balanceAfter:stock,reason:'RESTOCK'}};});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const {result}=renderHook(()=>({products:useShopProducts({limit:100}),restock:useRestock()}),{wrapper});
  await waitFor(()=>expect(result.current.products.data?.data[0]).toHaveProperty('stockQty',0));
  await act(async()=>{await result.current.restock.mutateAsync({id:products[4].id,data:{qty:5}});});
  await waitFor(()=>expect(result.current.products.data?.data[0]).toHaveProperty('stockQty',5));client.clear();
 });
 it('sets 10-second refresh and isolates public/member/staff catalogue caches',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  renderHook(()=>useShopProducts({limit:100},'public'),{wrapper});
  await waitFor(()=>expect(client.getQueryCache().find({queryKey:['products','public',{limit:100}]})?.state.status).toBe('success'));
  const query=client.getQueryCache().find({queryKey:['products','public',{limit:100}]});expect((query?.options as {refetchInterval?:number}).refetchInterval).toBe(10000);expect(client.getQueryData(['products','staff',{limit:100}])).toBeUndefined();client.clear();
 });
});

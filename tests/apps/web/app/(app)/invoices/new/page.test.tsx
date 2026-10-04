import React from'react';
import{fireEvent,render,screen,waitFor}from'@testing-library/react';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{beforeEach,describe,expect,it,vi}from'vitest';
import{invoiceApi}from'@/lib/invoice-api';
import NewInvoicePage from'../../../../../../../apps/web/src/app/(app)/invoices/new/page';
const state=vi.hoisted(()=>({allowed:true,push:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:state.push})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{id:'staff'},hasPermission:()=>state.allowed})}));
vi.mock('@/components/club/member-search',()=>({MemberSearch:({onChange}:{onChange:(member:unknown)=>void})=><button type="button" onClick={()=>onChange({id:'b0000000-0000-4000-8000-000000000001',fullName:'Aarav Mehta'})}>Choose Aarav</button>}));
vi.mock('@/lib/invoice-api',()=>({invoiceApi:{create:vi.fn(),clients:vi.fn()}}));
vi.mock('sonner',()=>({toast:{success:vi.fn()}}));
function mount(){const client=new QueryClient();return render(<QueryClientProvider client={client}><NewInvoicePage/></QueryClientProvider>);}
describe('new invoice form',()=>{
 beforeEach(()=>{vi.clearAllMocks();state.allowed=true;vi.mocked(invoiceApi.create).mockResolvedValue({id:'created'} as Awaited<ReturnType<typeof invoiceApi.create>>);});
 it('creates editable lines with rupee inputs converted into integer paise',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Choose Aarav'}));fireEvent.change(screen.getByLabelText('Description 1'),{target:{value:'Coaching'}});fireEvent.change(screen.getByLabelText('Quantity 1'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Unit price (₹) 1'),{target:{value:'125.50'}});fireEvent.click(screen.getByRole('button',{name:'Add line'}));fireEvent.change(screen.getByLabelText('Description 2'),{target:{value:'Equipment hire'}});fireEvent.change(screen.getByLabelText('Unit price (₹) 2'),{target:{value:'10'}});fireEvent.click(screen.getByRole('button',{name:'Remove line 2'}));fireEvent.click(screen.getByRole('button',{name:'Create invoice'}));await waitFor(()=>expect(invoiceApi.create).toHaveBeenCalledWith(expect.objectContaining({memberId:'b0000000-0000-4000-8000-000000000001',lines:[{description:'Coaching',qty:2,unitPricePaise:12550}]}),expect.anything()));expect(state.push).toHaveBeenCalledWith('/invoices/created');});
 it('blocks missing customers and descriptions',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Create invoice'}));await waitFor(()=>expect(screen.getByRole('alert')).toBeInTheDocument());expect(invoiceApi.create).not.toHaveBeenCalled();});
 it('hides creation without permission',()=>{state.allowed=false;mount();expect(screen.getByText('Invoice creation is unavailable')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Create invoice'})).not.toBeInTheDocument();});
});

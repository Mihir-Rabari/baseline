import React from'react';
import{fireEvent,render,screen,waitFor}from'@testing-library/react';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{beforeEach,describe,expect,it,vi}from'vitest';
import fixture from'@/mocks/invoice-created.json';
import{invoiceApi}from'@/lib/invoice-api';
import InvoiceDetailPage from'./page';
const state=vi.hoisted(()=>({allowed:true}));
vi.mock('next/navigation',()=>({useParams:()=>({id:'d0000000-0000-4000-8000-000000000001'})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{id:'staff'},hasPermission:()=>state.allowed})}));
vi.mock('@/lib/invoice-api',()=>({invoiceApi:{get:vi.fn(),send:vi.fn(),pay:vi.fn(),void:vi.fn()}}));
vi.mock('sonner',()=>({toast:{success:vi.fn()}}));
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><InvoiceDetailPage/></QueryClientProvider>);}
describe('invoice detail',()=>{
 beforeEach(()=>{vi.clearAllMocks();state.allowed=true;vi.mocked(invoiceApi.get).mockResolvedValue({...fixture,status:'DRAFT',billTo:{...fixture.billTo,type:'MEMBER'},payments:[]});vi.mocked(invoiceApi.pay).mockResolvedValue({} as Awaited<ReturnType<typeof invoiceApi.pay>>);});
 it('prints and records a partial payment with paise conversion',async()=>{const print=vi.spyOn(window,'print').mockImplementation(()=>{});mount();await waitFor(()=>expect(screen.getByRole('button',{name:'Print invoice'})).toBeInTheDocument());fireEvent.click(screen.getByRole('button',{name:'Print invoice'}));expect(print).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Record payment'}));fireEvent.change(screen.getByLabelText('Amount (₹)'),{target:{value:'250.50'}});fireEvent.click(screen.getByRole('button',{name:'Confirm payment'}));await waitFor(()=>expect(invoiceApi.pay).toHaveBeenCalledWith(fixture.id,{method:'CASH',amountPaise:25050}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());print.mockRestore();});
 it('requires a void reason and hides lifecycle actions without permission',async()=>{const view=mount();await waitFor(()=>expect(screen.getByRole('button',{name:'Void invoice'})).toBeInTheDocument());fireEvent.click(screen.getByRole('button',{name:'Void invoice'}));expect(screen.getByRole('button',{name:'Confirm void'})).toBeDisabled();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});state.allowed=false;view.rerender(<QueryClientProvider client={new QueryClient()}><InvoiceDetailPage/></QueryClientProvider>);await waitFor(()=>expect(screen.getByRole('button',{name:'Print invoice'})).toBeInTheDocument());expect(screen.queryByRole('button',{name:'Record payment'})).not.toBeInTheDocument();});
 it('shows explicit not-found state',async()=>{vi.mocked(invoiceApi.get).mockRejectedValue(Object.assign(new Error('Missing'),{statusCode:404}));mount();await waitFor(()=>expect(screen.getByText('Invoice not found')).toBeInTheDocument());});
 it('retains failed payment for retry',async()=>{vi.mocked(invoiceApi.pay).mockRejectedValue(new Error('Payment rejected'));mount();await waitFor(()=>expect(screen.getByRole('button',{name:'Record payment'})).toBeInTheDocument());fireEvent.click(screen.getByRole('button',{name:'Record payment'}));fireEvent.click(screen.getByRole('button',{name:'Confirm payment'}));await waitFor(()=>expect(screen.getAllByRole('alert').some((alert)=>alert.textContent?.includes('Payment rejected'))).toBe(true));expect(screen.getByRole('dialog')).toBeInTheDocument();});
});

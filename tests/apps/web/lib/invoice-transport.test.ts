import{beforeEach,describe,expect,it,vi}from'vitest';
vi.mock('@/lib/api-client',async()=>{const actual=await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');return{...actual,USE_MOCKS:false,fetchApi:vi.fn()};});
import{fetchApi}from'@/lib/api-client';
import{invoiceApi}from'../../../../apps/web/src/lib/invoice-api';
import invoice from'@/mocks/invoice-created.json';
describe('invoice transport',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('encodes IDs and preserves send/pay/void bodies',async()=>{
  vi.mocked(fetchApi).mockResolvedValue({...invoice,payments:[]});await invoiceApi.get('invoice/a');expect(fetchApi).toHaveBeenLastCalledWith('/api/v1/invoices/invoice%2Fa');
  await invoiceApi.send('invoice/a');expect(fetchApi).toHaveBeenLastCalledWith('/api/v1/invoices/invoice%2Fa/send',{method:'POST'});
  vi.mocked(fetchApi).mockResolvedValue({invoice,payment:{id:'d1000000-0000-4000-8000-000000000001',amountPaise:50000,method:'UPI'}});await invoiceApi.pay('invoice/a',{method:'UPI',amountPaise:50000});expect(fetchApi).toHaveBeenLastCalledWith('/api/v1/invoices/invoice%2Fa/pay',{method:'POST',body:JSON.stringify({method:'UPI',amountPaise:50000})});
  vi.mocked(fetchApi).mockResolvedValue(invoice);await invoiceApi.void('invoice/a',{reason:'Duplicate'});expect(fetchApi).toHaveBeenLastCalledWith('/api/v1/invoices/invoice%2Fa/void',{method:'POST',body:JSON.stringify({reason:'Duplicate'})});
 });
 it('rejects malformed payment before sending anything',async()=>{await expect(invoiceApi.pay('invoice',{method:'CASH',amountPaise:0})).rejects.toThrow();expect(fetchApi).not.toHaveBeenCalled();});
});

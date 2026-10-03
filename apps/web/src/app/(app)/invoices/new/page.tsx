'use client';
import React, {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Controller,useFieldArray,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {CreateInvoiceRequestSchema,type CreateInvoiceRequest,type MemberLookupItem} from '@packages/validation';
import {toast} from 'sonner';
import {useAuth} from '@/hooks/use-auth';
import {invoiceApi} from '@/lib/invoice-api';
import {MemberSearch} from '@/components/club/member-search';
import {PageHeader} from '@/components/app-shell/page-header';
import {EmptyState} from '@/components/app-shell/empty-state';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
export default function NewInvoicePage(){
  const{user,hasPermission}=useAuth();const router=useRouter();const client=useQueryClient();const[member,setMember]=useState<MemberLookupItem|null>(null);const[billType,setBillType]=useState('MEMBER');
  const form=useForm<CreateInvoiceRequest>({resolver:zodResolver(CreateInvoiceRequestSchema),defaultValues:{lines:[{description:'',qty:1,unitPricePaise:0}],notes:''}});const fields=useFieldArray({control:form.control,name:'lines'});
  const clients=useQuery({queryKey:['business-clients'],queryFn:invoiceApi.clients,enabled:billType==='BUSINESS_CLIENT'&&hasPermission('invoices:create')});
  const create=useMutation({mutationFn:invoiceApi.create,onSuccess:(invoice)=>{client.invalidateQueries({queryKey:['invoices']});toast.success('Invoice created');router.push(`/invoices/${invoice.id}`);}});
  if(!user)return null;
  return <div className="space-y-8"><PageHeader title="New invoice" description="Choose a customer and add invoice lines."/>{!hasPermission('invoices:create')?<EmptyState title="Invoice creation is unavailable"/>:<form className="space-y-5" noValidate onSubmit={form.handleSubmit((data)=>create.mutate(data))}><fieldset disabled={create.isPending} className="space-y-5"><Label htmlFor="bill-type">Customer type</Label><Select value={billType} onValueChange={(value)=>{setBillType(value);setMember(null);form.setValue('memberId',undefined);form.setValue('businessClientId',undefined);}}><SelectTrigger id="bill-type"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="MEMBER">Member</SelectItem><SelectItem value="BUSINESS_CLIENT">Business client</SelectItem></SelectContent></Select>{billType==='MEMBER'?<MemberSearch value={member} onChange={(value)=>{setMember(value);form.setValue('memberId',value?.id,{shouldValidate:true});}} disabled={create.isPending}/>:<><Label htmlFor="business-client">Business client</Label><Select onValueChange={(id)=>form.setValue('businessClientId',id,{shouldValidate:true})}><SelectTrigger id="business-client"><SelectValue placeholder="Choose a client"/></SelectTrigger><SelectContent>{clients.data?.data.map((value)=><SelectItem key={value.id} value={value.id}>{value.companyName}</SelectItem>)}</SelectContent></Select>{clients.error&&<p role="alert" className="text-destructive">Could not load business clients.</p>}</>}
    <div className="grid gap-4 sm:grid-cols-2">{(['issueDate','dueDate']as const).map((key)=><div key={key} className="space-y-2"><Label htmlFor={key}>{key==='issueDate'?'Issue date':'Due date'}</Label><DatePicker id={key} className="w-full" value={form.watch(key) ?? ''} onChange={(value) => form.setValue(key, value || undefined, { shouldDirty: true })} /></div>)}</div>
    <div className="space-y-4">{fields.fields.map((field,index)=><div key={field.id} className="grid gap-3 rounded-md border p-4 sm:grid-cols-[2fr_1fr_1fr_auto]"><div><Label htmlFor={`description-${index}`}>Description {index+1}</Label><Input id={`description-${index}`} {...form.register(`lines.${index}.description`)}/></div><div><Label htmlFor={`qty-${index}`}>Quantity {index+1}</Label><Input id={`qty-${index}`} type="number" min="1" step="1" {...form.register(`lines.${index}.qty`,{valueAsNumber:true})}/></div><div><Label htmlFor={`price-${index}`}>Unit price (₹) {index+1}</Label><Controller control={form.control} name={`lines.${index}.unitPricePaise`} render={({field:price})=><Input id={`price-${index}`} type="number" min="0" step="0.01" value={Number.isFinite(price.value)?price.value/100:''} onChange={(event)=>price.onChange(event.target.value===''?NaN:Math.round(Number(event.target.value)*100))}/>}/></div><Button type="button" variant="outline" disabled={fields.fields.length===1} onClick={()=>fields.remove(index)}>Remove line {index+1}</Button></div>)}<Button type="button" variant="outline" disabled={fields.fields.length>=50} onClick={()=>fields.append({description:'',qty:1,unitPricePaise:0})}>Add line</Button></div><Label htmlFor="invoice-notes">Notes</Label><Input id="invoice-notes" maxLength={2000} {...form.register('notes')}/>{Object.keys(form.formState.errors).length>0&&<p role="alert" className="text-destructive">Choose a customer, enter a description and positive whole quantity for every line, and check the dates.</p>}{create.error&&<p role="alert" className="text-destructive">{create.error.message}</p>}<Button disabled={create.isPending}>{create.isPending?'Creating…':'Create invoice'}</Button></fieldset></form>}</div>;
}

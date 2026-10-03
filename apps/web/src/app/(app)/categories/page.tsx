'use client';

import React from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/app-shell/page-header';
import { CategoryManager } from '@/components/club/category-manager';
import { NoAccess } from '@/components/club/ops-bits';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function CategoriesPage() {
  const { user, hasPermission } = useAuth();
  const canProducts = hasPermission('products:update');
  const canMenu = hasPermission('bar:manage') && hasPermission('reports:read');
  if (!user) return null;
  if (!canProducts && !canMenu) return <NoAccess what="category management" />;
  return (
    <div className="space-y-8">
      <PageHeader title="Categories" description="The lists that products and menu items are sorted into. Add, rename, reorder or switch them off." />
      <Tabs defaultValue={canProducts ? 'PRODUCT' : 'MENU'}>
        <TabsList>
          {canProducts && <TabsTrigger value="PRODUCT">Shop products</TabsTrigger>}
          {canMenu && <TabsTrigger value="MENU">Bar menu</TabsTrigger>}
        </TabsList>
        {canProducts && <TabsContent value="PRODUCT"><CategoryManager scope="PRODUCT" /></TabsContent>}
        {canMenu && <TabsContent value="MENU"><CategoryManager scope="MENU" /></TabsContent>}
      </Tabs>
    </div>
  );
}

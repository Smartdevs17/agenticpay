'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const MOCK_ANALYTICS = [
  { name: 'Jan', revenue: 4000 },
  { name: 'Feb', revenue: 5200 },
  { name: 'Mar', revenue: 6100 },
  { name: 'Apr', revenue: 7800 },
];

export default function SubscriptionDashboard() {
  const [plans] = useState([
    { id: 1, name: 'Basic AI Agent', price: '50 XLM', interval: 'Monthly', subscribers: 124 },
    { id: 2, name: 'Enterprise SaaS', price: '500 XLM', interval: 'Yearly', subscribers: 12 },
  ]);

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Subscription Management</h1>
        <Button>Create New Plan</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Monthly Recurring Revenue (MRR)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12,450 XLM</div>
            <p className="text-xs text-green-500">+12% from last month</p>
          </CardContent>
        </Card>
        {/* Additional Stats Cards... */}
      </div>

      <Card className="col-span-4">
        <CardHeader>
          <CardTitle>Revenue Growth</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={MOCK_ANALYTICS}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="revenue" stroke="#8884d8" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Active Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardContent className="pt-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold">{plan.name}</h3>
                    <p className="text-sm text-gray-500">{plan.price} / {plan.interval}</p>
                  </div>
                  <Badge>{plan.subscribers} Subscribers</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
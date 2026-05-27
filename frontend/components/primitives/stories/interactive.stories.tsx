import type { Meta, StoryObj } from '@storybook/react';
import { Interactive } from '../interactive';

const meta: Meta<typeof Interactive> = {
  title: 'Primitives/Interactive',
  component: Interactive,
  argTypes: {
    as: {
      control: 'select',
      options: ['button', 'a', 'span', 'div'],
    },
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon', 'icon-sm', 'icon-lg'],
    },
    disabled: {
      control: 'boolean',
    },
  },
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Interactive>;

export const Default: Story = {
  args: {
    children: 'Button',
  },
};

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Delete',
  },
};

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost',
  },
};

export const Link: Story = {
  args: {
    variant: 'link',
    children: 'Link',
  },
};

export const Small: Story = {
  args: {
    size: 'sm',
    children: 'Small',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
    children: 'Large',
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    children: 'Disabled',
  },
};

export const AsLink: Story = {
  args: {
    as: 'a',
    variant: 'outline',
    children: 'Link Button',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-4">
      <Interactive variant="default">Default</Interactive>
      <Interactive variant="destructive">Destructive</Interactive>
      <Interactive variant="outline">Outline</Interactive>
      <Interactive variant="secondary">Secondary</Interactive>
      <Interactive variant="ghost">Ghost</Interactive>
      <Interactive variant="link">Link</Interactive>
    </div>
  ),
};

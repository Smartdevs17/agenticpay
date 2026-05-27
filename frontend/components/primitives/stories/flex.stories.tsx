import type { Meta, StoryObj } from '@storybook/react';
import { Flex } from '../flex';

const meta: Meta<typeof Flex> = {
  title: 'Primitives/Flex',
  component: Flex,
  argTypes: {
    as: {
      control: 'select',
      options: ['div', 'span', 'section', 'article', 'aside', 'main', 'header', 'footer'],
    },
    direction: {
      control: 'select',
      options: ['row', 'col', 'row-reverse', 'col-reverse'],
    },
    justify: {
      control: 'select',
      options: ['start', 'end', 'center', 'between', 'around', 'evenly'],
    },
    items: {
      control: 'select',
      options: ['start', 'end', 'center', 'baseline', 'stretch'],
    },
    wrap: {
      control: 'select',
      options: ['nowrap', 'wrap', 'wrap-reverse'],
    },
    gap: {
      control: 'select',
      options: ['0', '1', '2', '3', '4', '6', '8', '12', '16'],
    },
  },
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Flex>;

export const Default: Story = {
  args: {
    children: (
      <>
        <div className="p-4 bg-blue-200 rounded">Item 1</div>
        <div className="p-4 bg-green-200 rounded">Item 2</div>
        <div className="p-4 bg-yellow-200 rounded">Item 3</div>
      </>
    ),
    gap: '4',
  },
};

export const Column: Story = {
  args: {
    direction: 'col',
    gap: '4',
    children: (
      <>
        <div className="p-4 bg-blue-200 rounded">Item 1</div>
        <div className="p-4 bg-green-200 rounded">Item 2</div>
        <div className="p-4 bg-yellow-200 rounded">Item 3</div>
      </>
    ),
  },
};

export const Centered: Story = {
  args: {
    justify: 'center',
    items: 'center',
    gap: '4',
    children: (
      <>
        <div className="p-4 bg-blue-200 rounded">Item 1</div>
        <div className="p-4 bg-green-200 rounded">Item 2</div>
        <div className="p-4 bg-yellow-200 rounded">Item 3</div>
      </>
    ),
  },
};

export const SpaceBetween: Story = {
  args: {
    justify: 'between',
    items: 'center',
    children: (
      <>
        <div className="p-4 bg-blue-200 rounded">Left</div>
        <div className="p-4 bg-green-200 rounded">Center</div>
        <div className="p-4 bg-yellow-200 rounded">Right</div>
      </>
    ),
  },
};

export const Wrapped: Story = {
  args: {
    wrap: 'wrap',
    gap: '4',
    children: (
      <>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="p-4 bg-blue-200 rounded">
            Item {i + 1}
          </div>
        ))}
      </>
    ),
  },
};

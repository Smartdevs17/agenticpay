import type { Meta, StoryObj } from '@storybook/react';
import { Text } from '../text';

const meta: Meta<typeof Text> = {
  title: 'Primitives/Text',
  component: Text,
  argTypes: {
    as: {
      control: 'select',
      options: ['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'label'],
    },
    variant: {
      control: 'select',
      options: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'small', 'muted', 'code'],
    },
    color: {
      control: 'select',
      options: ['foreground', 'muted', 'primary', 'destructive', 'success', 'warning', 'accent', 'secondary'],
    },
    weight: {
      control: 'select',
      options: ['normal', 'medium', 'semibold', 'bold'],
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'],
    },
    align: {
      control: 'select',
      options: ['left', 'center', 'right'],
    },
  },
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Text>;

export const Default: Story = {
  args: {
    children: 'Default text',
  },
};

export const Heading1: Story = {
  args: {
    as: 'h1',
    variant: 'h1',
    children: 'Heading 1',
  },
};

export const Heading2: Story = {
  args: {
    as: 'h2',
    variant: 'h2',
    children: 'Heading 2',
  },
};

export const Paragraph: Story = {
  args: {
    as: 'p',
    variant: 'p',
    children: 'This is a paragraph with some text content.',
  },
};

export const MutedText: Story = {
  args: {
    variant: 'muted',
    children: 'This is muted text',
  },
};

export const CodeText: Story = {
  args: {
    variant: 'code',
    children: 'const greeting = "Hello, World!";',
  },
};

export const ColoredText: Story = {
  args: {
    color: 'primary',
    children: 'Primary colored text',
  },
};

export const TruncatedText: Story = {
  args: {
    truncate: true,
    className: 'max-w-xs',
    children: 'This is a very long text that should be truncated when it exceeds the container width',
  },
};

export const AllHeadings: Story = {
  render: () => (
    <div className="space-y-4">
      <Text as="h1" variant="h1">Heading 1</Text>
      <Text as="h2" variant="h2">Heading 2</Text>
      <Text as="h3" variant="h3">Heading 3</Text>
      <Text as="h4" variant="h4">Heading 4</Text>
      <Text as="h5" variant="h5">Heading 5</Text>
      <Text as="h6" variant="h6">Heading 6</Text>
    </div>
  ),
};

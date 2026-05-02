import * as React from 'react';
import { Box, Flex, Text, Interactive } from '@/components/primitives';

/**
 * DesignSystemExample - Demonstrates the composable component architecture
 * 
 * This component shows how to use the new primitive components with design tokens.
 * It demonstrates:
 * - Polymorphic props (as prop)
 * - Token-driven styling
 * - Component composition
 * - Responsive patterns
 */
export function DesignSystemExample() {
  return (
    <Box className="p-6 space-y-8">
      {/* Typography Example */}
      <Box>
        <Text as="h2" variant="h2" className="mb-4">
          Typography System
        </Text>
        <Flex direction="col" gap="2">
          <Text variant="h1">Heading 1</Text>
          <Text variant="h2">Heading 2</Text>
          <Text variant="h3">Heading 3</Text>
          <Text variant="h4">Heading 4</Text>
          <Text variant="h5">Heading 5</Text>
          <Text variant="h6">Heading 6</Text>
          <Text variant="p">Paragraph text</Text>
          <Text variant="small">Small text</Text>
          <Text variant="muted">Muted text</Text>
        </Flex>
      </Box>

      {/* Colors Example */}
      <Box>
        <Text as="h2" variant="h2" className="mb-4">
          Color System
        </Text>
        <Flex direction="col" gap="2">
          <Text color="primary">Primary color text</Text>
          <Text color="secondary">Secondary color text</Text>
          <Text color="destructive">Destructive color text</Text>
          <Text color="success">Success color text</Text>
          <Text color="warning">Warning color text</Text>
          <Text color="muted">Muted color text</Text>
        </Flex>
      </Box>

      {/* Flex Layout Example */}
      <Box>
        <Text as="h2" variant="h2" className="mb-4">
          Flex Layout System
        </Text>
        <Flex direction="col" gap="4">
          <Flex gap="4" className="p-4 bg-muted rounded-lg">
            <Box className="p-4 bg-primary text-primary-foreground rounded">
              Item 1
            </Box>
            <Box className="p-4 bg-secondary text-secondary-foreground rounded">
              Item 2
            </Box>
            <Box className="p-4 bg-accent text-accent-foreground rounded">
              Item 3
            </Box>
          </Flex>

          <Flex direction="col" gap="2" className="p-4 bg-muted rounded-lg">
            <Box className="p-3 bg-card rounded">Column Item 1</Box>
            <Box className="p-3 bg-card rounded">Column Item 2</Box>
            <Box className="p-3 bg-card rounded">Column Item 3</Box>
          </Flex>
        </Flex>
      </Box>

      {/* Interactive Elements Example */}
      <Box>
        <Text as="h2" variant="h2" className="mb-4">
          Interactive Elements
        </Text>
        <Flex gap="4" wrap="wrap">
          <Interactive variant="default">Default Button</Interactive>
          <Interactive variant="destructive">Destructive Button</Interactive>
          <Interactive variant="outline">Outline Button</Interactive>
          <Interactive variant="secondary">Secondary Button</Interactive>
          <Interactive variant="ghost">Ghost Button</Interactive>
          <Interactive variant="link">Link Button</Interactive>
        </Flex>
      </Box>

      {/* Polymorphic Props Example */}
      <Box>
        <Text as="h2" variant="h2" className="mb-4">
          Polymorphic Props
        </Text>
        <Flex direction="col" gap="2">
          <Text as="p">
            This Text component renders as a paragraph
          </Text>
          <Text as="span" color="muted">
            This Text component renders as a span
          </Text>
          <Text as="label" htmlFor="input" color="primary">
            This Text component renders as a label
          </Text>
          <Box as="section" className="p-4 bg-muted rounded">
            This Box component renders as a section
          </Box>
          <Flex as="nav" gap="4">
            <Box as="a" href="#" className="text-primary hover:underline">
              Link 1
            </Box>
            <Box as="a" href="#" className="text-primary hover:underline">
              Link 2
            </Box>
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
}

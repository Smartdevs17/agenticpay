'use client';

import React, { useCallback, useState } from 'react';
import { useCollaboration } from './useCollaboration';
import { PresenceIndicators } from './PresenceIndicators';
import { CollaborativeField } from './CollaborativeField';
import { EditHistoryPanel } from './EditHistoryPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  name: string;
  description: string;
  webhookUrl: string;
  apiKey: string;
  signingSecret: string;
  successRedirectUrl: string;
  cancelRedirectUrl: string;
  currency: string;
}

interface CollaborativeProjectConfigProps {
  projectId: string;
  initialConfig: ProjectConfig;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  onSave?: (config: ProjectConfig) => Promise<void>;
  wsServerUrl?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollaborativeProjectConfig({
  projectId,
  initialConfig,
  userId,
  displayName,
  avatarUrl,
  onSave,
  wsServerUrl = '',
}: CollaborativeProjectConfigProps) {
  const [config, setConfig] = useState<ProjectConfig>(initialConfig);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const collaboration = useCollaboration({
    projectId,
    userId,
    displayName,
    avatarUrl,
    serverUrl: wsServerUrl,
    onRemoteOperation: useCallback(
      (op) => {
        if (op.type === 'set' && op.path.length === 1) {
          const field = op.path[0] as keyof ProjectConfig;
          setConfig((prev) => ({ ...prev, [field]: op.value as string }));
        }
      },
      []
    ),
  });

  const handleFieldChange = useCallback(
    (field: keyof ProjectConfig) => (value: string) => {
      setConfig((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(config);
      setSaveMessage('Saved successfully');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch {
      setSaveMessage('Save failed — try again');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                collaboration.isConnected ? 'bg-green-400' : 'bg-gray-300 animate-pulse'
              }`}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {collaboration.isConnected ? 'Live' : 'Connecting…'}
            </span>
          </div>
          <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
          <PresenceIndicators
            participants={collaboration.participants}
            currentUserId={userId}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">v{collaboration.currentVersion}</span>
          <button
            onClick={() => setHistoryOpen(true)}
            className="text-xs text-blue-500 hover:text-blue-700 underline transition-colors"
          >
            History
          </button>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-5">
        <section>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 uppercase tracking-wide">
            General
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <CollaborativeField
              label="Project Name"
              fieldPath={['name']}
              value={config.name}
              onChange={handleFieldChange('name')}
              collaboration={collaboration}
              currentUserId={userId}
            />
            <CollaborativeField
              label="Currency"
              fieldPath={['currency']}
              value={config.currency}
              onChange={handleFieldChange('currency')}
              collaboration={collaboration}
              currentUserId={userId}
              placeholder="USD"
            />
          </div>
          <div className="mt-4">
            <CollaborativeField
              label="Description"
              fieldPath={['description']}
              value={config.description}
              onChange={handleFieldChange('description')}
              collaboration={collaboration}
              currentUserId={userId}
              placeholder="Brief project description"
            />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 uppercase tracking-wide">
            Redirects
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <CollaborativeField
              label="Success Redirect URL"
              fieldPath={['successRedirectUrl']}
              value={config.successRedirectUrl}
              onChange={handleFieldChange('successRedirectUrl')}
              collaboration={collaboration}
              currentUserId={userId}
              type="url"
              placeholder="https://example.com/success"
            />
            <CollaborativeField
              label="Cancel Redirect URL"
              fieldPath={['cancelRedirectUrl']}
              value={config.cancelRedirectUrl}
              onChange={handleFieldChange('cancelRedirectUrl')}
              collaboration={collaboration}
              currentUserId={userId}
              type="url"
              placeholder="https://example.com/cancel"
            />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 uppercase tracking-wide">
            Security — Critical Fields
          </h3>
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
            These fields are locked during editing to prevent concurrent conflicts.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <CollaborativeField
              label="Webhook URL"
              fieldPath={['webhookUrl']}
              value={config.webhookUrl}
              onChange={handleFieldChange('webhookUrl')}
              collaboration={collaboration}
              currentUserId={userId}
              type="url"
              isCritical
              placeholder="https://example.com/webhook"
            />
            <CollaborativeField
              label="Signing Secret"
              fieldPath={['signingSecret']}
              value={config.signingSecret}
              onChange={handleFieldChange('signingSecret')}
              collaboration={collaboration}
              currentUserId={userId}
              type="password"
              isCritical
            />
          </div>
          <div className="mt-4">
            <CollaborativeField
              label="API Key"
              fieldPath={['apiKey']}
              value={config.apiKey}
              onChange={handleFieldChange('apiKey')}
              collaboration={collaboration}
              currentUserId={userId}
              type="password"
              isCritical
            />
          </div>
        </section>
      </div>

      {/* Save bar */}
      {onSave && (
        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isSaving ? 'Saving…' : 'Save Changes'}
          </button>
          {saveMessage && (
            <span
              className={`text-sm ${
                saveMessage.includes('failed') ? 'text-red-500' : 'text-green-500'
              }`}
            >
              {saveMessage}
            </span>
          )}
        </div>
      )}

      {/* Edit history panel */}
      <EditHistoryPanel
        history={collaboration.editHistory}
        participants={collaboration.participants}
        currentVersion={collaboration.currentVersion}
        onRollback={collaboration.rollbackTo}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}

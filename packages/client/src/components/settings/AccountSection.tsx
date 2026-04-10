import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { useSettingsStore, useWorkspaceStore, useDeviceConfigStore } from '../../stores';
import { requestAccountSwitch } from '../../services/relaySender';
import type { AccountType } from '@estelle/core';
import { cn } from '../../lib/utils';

/**
 * 계정 전환 섹션
 *
 * 회사(LineGames) / 개인(Personal) 계정 전환 UI를 제공합니다.
 * 모든 연결된 Pylon에 동시에 계정 전환을 요청합니다.
 */
export function AccountSection() {
  const currentAccount = useSettingsStore((s) => s.currentAccount);
  const isAccountSwitching = useSettingsStore((s) => s.isAccountSwitching);
  const setAccountSwitching = useSettingsStore((s) => s.setAccountSwitching);
  const accountByPylon = useSettingsStore((s) => s.accountByPylon);
  const connectedPylons = useWorkspaceStore((s) => s.connectedPylons);
  const getName = useDeviceConfigStore((s) => s.getName);

  const handleSwitch = (account: AccountType) => {
    if (account === currentAccount || isAccountSwitching) return;

    setAccountSwitching(true);
    requestAccountSwitch(account);
  };

  const getAccountLabel = (account: AccountType | null) => {
    if (!account) return '-';
    return account === 'linegames' ? 'LineGames' : 'Personal';
  };

  return (
    <Card data-section="account">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span>🔐</span>
          계정
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-3">
          <Button
            variant={currentAccount === 'linegames' ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'flex-1',
              currentAccount === 'linegames' && 'bg-primary'
            )}
            onClick={() => handleSwitch('linegames')}
            disabled={isAccountSwitching}
          >
            {isAccountSwitching && currentAccount !== 'linegames' ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            LineGames
          </Button>
          <Button
            variant={currentAccount === 'personal' ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'flex-1',
              currentAccount === 'personal' && 'bg-primary'
            )}
            onClick={() => handleSwitch('personal')}
            disabled={isAccountSwitching}
          >
            {isAccountSwitching && currentAccount !== 'personal' ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            Personal
          </Button>
        </div>

        {connectedPylons.length > 0 && (
          <div className="space-y-1 mb-2">
            {connectedPylons.map((pylon) => {
              const account = accountByPylon.get(pylon.deviceId) ?? null;
              return (
                <div
                  key={pylon.deviceId}
                  className="flex justify-between items-center text-xs text-muted-foreground px-1"
                >
                  <span>{getName(pylon.deviceId)}</span>
                  <span
                    className={cn(
                      'font-medium',
                      account === 'linegames' && 'text-blue-400',
                      account === 'personal' && 'text-green-400',
                      !account && 'text-muted-foreground'
                    )}
                  >
                    {getAccountLabel(account)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {connectedPylons.length === 0 && currentAccount && (
          <div className="text-center mb-2">
            <p className="text-sm text-muted-foreground">
              현재:{' '}
              <span className="font-medium text-foreground">
                {getAccountLabel(currentAccount)}
              </span>
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center mt-2">
          ⚠️ 계정 변경 시 모든 Pylon의 세션이 재시작됩니다
        </p>
      </CardContent>
    </Card>
  );
}

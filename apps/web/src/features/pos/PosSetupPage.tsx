import type { Branch } from '@pos/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';
import { useBrandSettings } from '../settings/settings-api';
import { readTerminal, saveTerminal } from './terminal-store';

// A manager picks the branch of this terminal once. Then they are signed out, and the staff of
// the branch sign in with their PIN. See docs/specs/006-pos-terminal.md, rule 1.
export function PosSetupPage() {
  const { t, i18n } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  // The screen to go back to: the POS, or the kitchen display.
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') === '/kds' ? '/kds' : '/pos';
  const { brands, branches, isLoading, isError } = useDirectory();
  const [chosen, setChosen] = useState<string | null>(() => readTerminal()?.branchId ?? null);
  const [saving, setSaving] = useState(false);
  // A kitchen screen may be for one station of the brand ('' means all of them; spec 009, rule 6).
  const [stationId, setStationId] = useState<string>(() => readTerminal()?.stationId ?? '');

  const brandName = (brandId: string) => brands.find((brand) => brand.id === brandId)?.name;
  const label = (branch: Branch) => {
    const brand = brandName(branch.brandId);
    const name = localize(branch.name, i18n.language);
    return brand ? `${localize(brand, i18n.language)} · ${name}` : name;
  };
  const sorted = [...branches].sort((a, b) => label(a).localeCompare(label(b), i18n.language));
  const branch = branches.find((candidate) => candidate.id === chosen);
  const settings = useBrandSettings(next === '/kds' ? (branch?.brandId ?? null) : null);
  const stations = settings.data?.kitchenStations ?? [];
  const station = stations.find((candidate) => candidate.id === stationId);

  async function save() {
    if (!branch) return;
    setSaving(true);
    saveTerminal({
      branchId: branch.id,
      brandId: branch.brandId,
      branchName: branch.name,
      brandName: brandName(branch.brandId) ?? null,
      stationId: station?.id ?? null,
      stationName: station?.name ?? null,
    });
    await logout();
    void navigate(next, { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-slate-900">{t('pos.setup.title')}</h1>
          <LanguageSwitcher />
        </div>
        <p className="mb-4 text-sm text-slate-600">{t('pos.setup.intro')}</p>

        {isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
        {isError && (
          <p role="alert" className="text-sm text-red-700">
            {t('common.loadError')}
          </p>
        )}
        {!isLoading && !isError && branches.length === 0 && (
          <p className="text-sm text-slate-500">{t('pos.setup.noBranches')}</p>
        )}

        {sorted.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">
              {t('pos.setup.branch')}
            </legend>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {sorted.map((candidate) => (
                <label
                  key={candidate.id}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                    candidate.isActive
                      ? 'border-slate-200 hover:bg-slate-50'
                      : 'border-slate-100 text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="branch"
                    value={candidate.id}
                    disabled={!candidate.isActive}
                    checked={chosen === candidate.id}
                    onChange={() => setChosen(candidate.id)}
                  />
                  <span className="min-w-0 flex-1">
                    {label(candidate)}
                    {!candidate.isActive && ` ${t('common.inactiveSuffix')}`}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {stations.length > 0 && (
          <label className="mt-4 block text-sm font-medium text-slate-700">
            {t('pos.setup.station')}
            <select
              value={station ? stationId : ''}
              onChange={(event) => setStationId(event.target.value)}
              className={fieldClass}
            >
              <option value="">{t('pos.setup.allStations')}</option>
              {stations.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {localize(candidate.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void navigate('/admin')}
            className={secondaryButtonClass}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!branch?.isActive || saving}
            onClick={() => void save()}
            className={primaryButtonClass}
          >
            {t('pos.setup.save')}
          </button>
        </div>
      </div>
    </main>
  );
}

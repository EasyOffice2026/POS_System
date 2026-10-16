import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, uploadImage, type ImageKind } from '../lib/api';
import { FormField, fieldAttributes, fieldClass, secondaryButtonClass } from './form';

interface ImageFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  value: string;
  onChange: (url: string) => void;
  // What the photo is for; it decides the right needed and where the file goes.
  kind: ImageKind;
  // A group admin names the brand; a brand's own staff do not need to.
  brandId?: string | undefined;
  // No upload button at all: the form is read-only, or the brand is not saved yet.
  canUpload?: boolean;
  disabled?: boolean;
}

export const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// A link to a picture, with a preview, and a button to upload a file instead of typing a link.
// The upload answers the address that then fills the link.
export function ImageField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  kind,
  brandId,
  canUpload = true,
  disabled = false,
}: ImageFieldProps) {
  const { t } = useTranslation();
  const fileId = useId();
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    if (!IMAGE_TYPES.split(',').includes(file.type)) {
      setUploadError(t('image.errors.type'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError(t('image.errors.size'));
      return;
    }
    setBusy(true);
    try {
      const { url } = await uploadImage(file, { kind, brandId });
      onChange(url);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'UNKNOWN';
      setUploadError(
        code === 'STORAGE_NOT_SET_UP' ? t('image.errors.notSetUp') : t('image.errors.failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const shownError = error ?? uploadError ?? undefined;

  return (
    <FormField id={id} label={label} hint={hint} error={shownError}>
      <div className="flex items-start gap-3">
        {value ? (
          <img
            src={value}
            alt=""
            className="h-16 w-16 shrink-0 rounded-md border border-slate-200 object-cover"
          />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded-md border border-dashed border-slate-300" />
        )}
        <div className="min-w-0 flex-1">
          <input
            {...fieldAttributes(id, { hint: Boolean(hint), error: Boolean(shownError) })}
            type="url"
            dir="ltr"
            autoComplete="off"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className={fieldClass}
          />
          {canUpload && !disabled && (
            <div className="mt-2 flex items-center gap-3">
              <label htmlFor={fileId} className={`${secondaryButtonClass} cursor-pointer`}>
                {busy ? t('image.uploading') : t('image.upload')}
                <input
                  id={fileId}
                  type="file"
                  accept={IMAGE_TYPES}
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </label>
              <span className="text-xs text-slate-500">{t('image.uploadHint')}</span>
            </div>
          )}
        </div>
      </div>
    </FormField>
  );
}

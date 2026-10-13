import { closedWeek, type OpeningHours } from '@pos/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  branchDetail,
  burgerBrand,
  groupAdmin,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const one = `GET /api/v1/branches/${pizzaMall.id}`;
const patch = `PATCH /api/v1/branches/${pizzaMall.id}`;

const week = (days: Partial<OpeningHours>): OpeningHours => ({ ...closedWeek(), ...days });

const ranges = (...pairs: [string, string][]) => ({
  kind: 'ranges' as const,
  ranges: pairs.map(([open, close]) => ({ open, close })),
});

const withHours = (days: Partial<OpeningHours>) =>
  branchDetail({ config: { openingHours: week(days), printers: [], dayEndsAt: '00:00' } });

function openHours(branch = branchDetail(), extra: Record<string, MockHandler> = {}) {
  const api = mockApi({
    [REFRESH]: () => json(sessionFor(groupAdmin)),
    [one]: () => json(branch),
    'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
    [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
    [`GET /api/v1/brands/${burgerBrand.id}/branches`]: () => json(page([])),
    ...extra,
  });
  renderApp(`/admin/branches/${pizzaMall.id}?tab=hours`);
  return api;
}

const day = (name: string) => screen.getByRole('group', { name });
const bodyOf = (api: ReturnType<typeof mockApi>) =>
  api.calls.find((call) => call.key === patch)?.body;

const setTime = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('the opening hours of a branch', () => {
  it('shows the seven days, the week starting on Sunday', async () => {
    openHours();

    await screen.findByLabelText('Hours on Sunday');

    expect(
      screen.getAllByRole('group').map((group) => group.querySelector('legend')?.textContent),
    ).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  });

  it('shows closed days, a day open all day, and the ranges of a day', async () => {
    openHours(
      withHours({
        monday: ranges(['09:00', '14:00'], ['17:00', '23:30']),
        friday: { kind: 'all_day' },
      }),
    );

    await screen.findByLabelText('Hours on Sunday');

    expect(screen.getByLabelText('Hours on Sunday')).toHaveValue('closed');
    expect(screen.getByLabelText('Hours on Friday')).toHaveValue('all_day');
    expect(screen.getByLabelText('Hours on Monday')).toHaveValue('ranges');
    expect(screen.getByLabelText('Monday: opens (range 1)')).toHaveValue('09:00');
    expect(screen.getByLabelText('Monday: closes (range 1)')).toHaveValue('14:00');
    expect(screen.getByLabelText('Monday: opens (range 2)')).toHaveValue('17:00');
    expect(screen.getByLabelText('Monday: closes (range 2)')).toHaveValue('23:30');
    expect(screen.queryByLabelText('Sunday: opens (range 1)')).not.toBeInTheDocument();
  });

  it('says when a range closes the next day', async () => {
    openHours(
      withHours({ friday: ranges(['14:00', '01:00']), monday: ranges(['09:00', '17:00']) }),
    );

    await screen.findByLabelText('Hours on Sunday');

    expect(within(day('Friday')).getByText('The next day')).toBeInTheDocument();
    expect(within(day('Monday')).queryByText('The next day')).not.toBeInTheDocument();
  });

  it('starts a range from nine to five when a closed day is given specific hours', async () => {
    const user = userEvent.setup();
    openHours();

    await user.selectOptions(await screen.findByLabelText('Hours on Sunday'), 'ranges');

    expect(screen.getByLabelText('Sunday: opens (range 1)')).toHaveValue('09:00');
    expect(screen.getByLabelText('Sunday: closes (range 1)')).toHaveValue('17:00');
  });

  it('writes the times left to right, whatever the language of the screen', async () => {
    openHours(withHours({ monday: ranges(['09:00', '17:00']) }));

    expect(await screen.findByLabelText('Monday: opens (range 1)')).toHaveAttribute('dir', 'ltr');
  });
});

describe('changing the ranges of a day', () => {
  it('adds a range, and removes one', async () => {
    const user = userEvent.setup();
    openHours(withHours({ monday: ranges(['09:00', '14:00']) }));
    await screen.findByLabelText('Hours on Monday');

    await user.click(within(day('Monday')).getByRole('button', { name: 'Add hours' }));
    expect(screen.getByLabelText('Monday: opens (range 2)')).toHaveValue('09:00');

    setTime('Monday: opens (range 2)', '17:00');
    await user.click(screen.getByRole('button', { name: 'Remove range 1 of Monday' }));

    expect(screen.queryByLabelText('Monday: opens (range 2)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Monday: opens (range 1)')).toHaveValue('17:00');
  });

  it('stops offering more ranges at the limit of six', async () => {
    openHours(
      withHours({
        monday: ranges(
          ['01:00', '02:00'],
          ['03:00', '04:00'],
          ['05:00', '06:00'],
          ['07:00', '08:00'],
          ['09:00', '10:00'],
          ['11:00', '12:00'],
        ),
      }),
    );
    await screen.findByLabelText('Hours on Monday');

    expect(
      within(day('Monday')).queryByRole('button', { name: 'Add hours' }),
    ).not.toBeInTheDocument();
    expect(
      within(day('Tuesday')).queryByRole('button', { name: 'Add hours' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the ranges while the day is closed, and brings them back', async () => {
    const user = userEvent.setup();
    openHours(withHours({ monday: ranges(['09:00', '14:00'], ['17:00', '23:00']) }));
    const select = await screen.findByLabelText('Hours on Monday');

    await user.selectOptions(select, 'closed');
    expect(screen.queryByLabelText('Monday: opens (range 1)')).not.toBeInTheDocument();
    await user.selectOptions(select, 'ranges');

    expect(screen.getByLabelText('Monday: opens (range 1)')).toHaveValue('09:00');
    expect(screen.getByLabelText('Monday: closes (range 2)')).toHaveValue('23:00');
  });

  it('copies the hours of one day to every day', async () => {
    const user = userEvent.setup();
    openHours(withHours({ monday: ranges(['10:00', '15:00'], ['18:00', '23:00']) }));
    await screen.findByLabelText('Hours on Monday');

    await user.click(within(day('Monday')).getByRole('button', { name: 'Copy to all days' }));

    for (const name of ['Sunday', 'Tuesday', 'Saturday']) {
      expect(screen.getByLabelText(`Hours on ${name}`)).toHaveValue('ranges');
      expect(screen.getByLabelText(`${name}: opens (range 1)`)).toHaveValue('10:00');
      expect(screen.getByLabelText(`${name}: closes (range 2)`)).toHaveValue('23:00');
    }
  });

  it('does not let a copy share its ranges with the day it came from', async () => {
    const user = userEvent.setup();
    openHours(withHours({ monday: ranges(['10:00', '15:00']) }));
    await screen.findByLabelText('Hours on Monday');
    await user.click(within(day('Monday')).getByRole('button', { name: 'Copy to all days' }));

    setTime('Tuesday: opens (range 1)', '12:00');

    expect(screen.getByLabelText('Monday: opens (range 1)')).toHaveValue('10:00');
  });
});

describe('saving the opening hours', () => {
  it('sends the whole week, a day at a time, and says it is saved', async () => {
    const user = userEvent.setup();
    const api = openHours(withHours({ friday: { kind: 'all_day' } }), {
      [patch]: () =>
        json(withHours({ friday: { kind: 'all_day' }, sunday: ranges(['09:00', '17:00']) })),
    });
    await user.selectOptions(await screen.findByLabelText('Hours on Sunday'), 'ranges');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Opening hours saved.');
    expect(bodyOf(api)).toEqual({
      config: {
        dayEndsAt: '00:00',
        openingHours: week({ sunday: ranges(['09:00', '17:00']), friday: { kind: 'all_day' } }),
      },
    });
  });

  it('does not send the ranges of a closed day', async () => {
    const user = userEvent.setup();
    const api = openHours(withHours({ monday: ranges(['09:00', '14:00']) }), {
      [patch]: () => json(branchDetail()),
    });
    await user.selectOptions(await screen.findByLabelText('Hours on Monday'), 'closed');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api)).toEqual({ config: { openingHours: closedWeek(), dayEndsAt: '00:00' } });
  });

  it('shows the hours the way the server kept them, the ranges in the order of the clock', async () => {
    const user = userEvent.setup();
    openHours(withHours({ monday: ranges(['17:00', '23:00']) }), {
      [patch]: () => json(withHours({ monday: ranges(['09:00', '14:00'], ['17:00', '23:00']) })),
    });
    await screen.findByLabelText('Hours on Monday');
    await user.click(within(day('Monday')).getByRole('button', { name: 'Add hours' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(screen.getByLabelText('Monday: opens (range 1)')).toHaveValue('09:00');
    expect(screen.getByLabelText('Monday: opens (range 2)')).toHaveValue('17:00');
  });

  it('takes the saved message away when something is changed again', async () => {
    const user = userEvent.setup();
    openHours(branchDetail(), { [patch]: () => json(branchDetail()) });
    await screen.findByLabelText('Hours on Sunday');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');

    await user.selectOptions(screen.getByLabelText('Hours on Sunday'), 'all_day');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says so when the hours could not be saved', async () => {
    const user = userEvent.setup();
    openHours(branchDetail(), { [patch]: () => errorResponse(500, 'INTERNAL_ERROR') });
    await screen.findByLabelText('Hours on Sunday');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');
  });
});

describe('problems with the opening hours', () => {
  it('names the day with ranges that overlap, and sends nothing', async () => {
    const user = userEvent.setup();
    const api = openHours(withHours({ monday: ranges(['09:00', '14:00']) }));
    await screen.findByLabelText('Hours on Monday');
    await user.click(within(day('Monday')).getByRole('button', { name: 'Add hours' }));
    setTime('Monday: opens (range 2)', '13:00');
    setTime('Monday: closes (range 2)', '18:00');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      within(day('Monday')).getByText('These hours overlap with other hours.'),
    ).toBeInTheDocument();
    expect(
      within(day('Tuesday')).queryByText('These hours overlap with other hours.'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hours on Monday')).toHaveAccessibleDescription(
      'These hours overlap with other hours.',
    );
    expect(screen.getByLabelText('Hours on Tuesday')).not.toHaveAttribute('aria-invalid');
    expect(bodyOf(api)).toBeUndefined();
  });

  it('finds Saturday night running into Sunday morning, and names Sunday', async () => {
    const user = userEvent.setup();
    const api = openHours(withHours({ saturday: ranges(['22:00', '03:00']) }));
    await user.selectOptions(await screen.findByLabelText('Hours on Sunday'), 'ranges');
    setTime('Sunday: opens (range 1)', '02:00');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      within(day('Sunday')).getByText('These hours overlap with other hours.'),
    ).toBeInTheDocument();
    expect(
      within(day('Saturday')).queryByText('These hours overlap with other hours.'),
    ).not.toBeInTheDocument();
    expect(bodyOf(api)).toBeUndefined();
  });

  it('refuses a range that opens and closes at the same time, on that range', async () => {
    const user = userEvent.setup();
    openHours(withHours({ monday: ranges(['09:00', '14:00']) }));
    await screen.findByLabelText('Hours on Monday');
    setTime('Monday: closes (range 1)', '09:00');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      within(day('Monday')).getByText('The closing time must differ from the opening time.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Monday: closes (range 1)')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // A screen reader reads the problem with the time it belongs to.
    for (const label of ['Monday: opens (range 1)', 'Monday: closes (range 1)']) {
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
        'The closing time must differ from the opening time.',
      );
    }
  });

  it('asks for a time that was cleared', async () => {
    const user = userEvent.setup();
    const api = openHours(withHours({ monday: ranges(['09:00', '14:00']) }));
    await screen.findByLabelText('Hours on Monday');
    setTime('Monday: opens (range 1)', '');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(within(day('Monday')).getByText('Enter a time.')).toBeInTheDocument();
    expect(bodyOf(api)).toBeUndefined();
  });

  it('asks for a range on a day with specific hours but none left', async () => {
    const user = userEvent.setup();
    const api = openHours(withHours({ monday: ranges(['09:00', '14:00']) }));
    await screen.findByLabelText('Hours on Monday');
    await user.click(screen.getByRole('button', { name: 'Remove range 1 of Monday' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      within(day('Monday')).getByText('Add at least one range, or choose Closed.'),
    ).toBeInTheDocument();
    expect(bodyOf(api)).toBeUndefined();
  });

  it('clears a problem once the hours are put right and saved', async () => {
    const user = userEvent.setup();
    openHours(withHours({ monday: ranges(['09:00', '14:00']) }), {
      [patch]: () => json(withHours({ monday: ranges(['09:00', '10:00']) })),
    });
    await screen.findByLabelText('Hours on Monday');
    setTime('Monday: closes (range 1)', '09:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('The closing time must differ from the opening time.'),
    ).toBeInTheDocument();

    setTime('Monday: closes (range 1)', '10:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(
      screen.queryByText('The closing time must differ from the opening time.'),
    ).not.toBeInTheDocument();
  });

  it('shows a problem the server finds on the day that has it', async () => {
    const user = userEvent.setup();
    openHours(branchDetail(), {
      [patch]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [
          { path: 'config.openingHours.tuesday', message: 'HOURS_OVERLAP' },
        ]),
    });
    await screen.findByLabelText('Hours on Sunday');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await within(day('Tuesday')).findByText('These hours overlap with other hours.'),
    ).toBeInTheDocument();
  });
});

describe('the opening hours in Arabic', () => {
  it('writes the days, the choices and the messages in Arabic when the language is switched', async () => {
    const user = userEvent.setup();
    openHours(withHours({ friday: ranges(['14:00', '01:00']) }));
    await screen.findByLabelText('Hours on Sunday');

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    const friday = await screen.findByRole('group', { name: 'الجمعة' });
    expect(within(friday).getByLabelText('ساعات يوم الجمعة')).toHaveValue('ranges');
    expect(within(friday).getByRole('option', { name: 'ساعات محددة' })).toBeInTheDocument();
    expect(within(friday).getByRole('option', { name: 'مفتوح 24 ساعة' })).toBeInTheDocument();
    expect(within(friday).getByText('اليوم التالي')).toBeInTheDocument();
    expect(within(friday).getByLabelText('الجمعة: الافتتاح (الفترة 1)')).toHaveAttribute(
      'dir',
      'ltr',
    );
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeInTheDocument();
  });

  it('keeps a problem in step with the language', async () => {
    const user = userEvent.setup();
    openHours(withHours({ monday: ranges(['09:00', '14:00']) }));
    await screen.findByLabelText('Hours on Monday');
    setTime('Monday: closes (range 1)', '09:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('The closing time must differ from the opening time.');

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    await waitFor(() =>
      expect(screen.getByText('يجب أن يختلف وقت الإغلاق عن وقت الافتتاح.')).toBeInTheDocument(),
    );
  });
});

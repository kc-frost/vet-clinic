import { useEffect, useMemo, useState } from "react";
import { DayPicker, type DayClickEventHandler } from "react-day-picker";
import "react-day-picker/dist/style.css";
import "./slotCalendar.css";

//represents one available appointment slot coming from the parent
//date is in yyyy-mm-dd format
//startTime and endTime are in hh:mm format
export type SlotCalendarSlot = {
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
};

//represents the selected value that gets passed back up to the parent
//slotId is optional because sometimes we only care about date + startTime
export type SlotCalendarValue = {
  date: string;
  startTime: string;
  slotId?: string;
};

//props for the calendar component
type Props = {
  //full list of slots the parent already fetched
  slots: SlotCalendarSlot[];

  //how many months ahead the user is allowed to browse
  //defaults to 2 if not passed in
  monthsForward?: number;

  //optional controlled value from the parent
  //if parent passes this in, we mirror it into local state
  value?: SlotCalendarValue | null;

  //callback fired when user clicks a time button
  onSelectSlot: (value: SlotCalendarValue) => void;

  //callback fired when user clicks a date
  //used by the parent to clear any old time selection if a new date is chosen
  onBrowseDateChange?: (date: string) => void;

  //optional UI states
  isLoading?: boolean;
  errorText?: string;
};

//returns a copy of the date with time reset to midnight
//useful when we want to compare calendar days only and ignore hours/minutes
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

//returns the first day of the month for a given date
//example if d is march 18 this returns march 1
function firstDayOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

//returns a new Date moved forward or backward by some number of months
//passing -1 goes one month back, passing 1 goes one month forward
function addMonths(d: Date, months: number) {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

//takes a yyyy-mm-dd string and safely turns it into a Date object
//returns null if the text is not in the expected format
function parseYYYYMMDD(yyyyMmDd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;

  const year = Number(yyyyMmDd.slice(0, 4));
  const month = Number(yyyyMmDd.slice(5, 7));
  const day = Number(yyyyMmDd.slice(8, 10));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  return new Date(year, month - 1, day);
}

//turns a Date object back into yyyy-mm-dd text
function toYYYYMMDD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

//returns a readable title like "March 2026"
function monthTitle(d: Date) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

//turns 24 hour time like 13:30 into 1:30 PM for the ui
function formatTime12Hour(hhmm: string) {
  const parts = hhmm.split(":");
  if (parts.length < 2) return hhmm;

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return hhmm;

  const temp = new Date();
  temp.setHours(hours, minutes, 0, 0);

  return temp.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function SlotCalendar({
  slots,
  monthsForward = 2,
  value = null,
  onSelectSlot,
  onBrowseDateChange,
  isLoading = false,
  errorText = "",
}: Props) {
  //today with time zeroed out
  const today = useMemo(() => startOfDay(new Date()), []);

  //minimum visible month is the current month
  const minMonth = useMemo(() => firstDayOfMonth(today), [today]);

  //maximum visible month is current month plus however many months forward we allow
  const maxMonth = useMemo(() => addMonths(minMonth, monthsForward), [minMonth, monthsForward]);

  //group all slots by date
  //this makes it easy to get all time buttons for a selected day
  const slotsByDate = useMemo(() => {
    const map: Record<string, SlotCalendarSlot[]> = {};

    for (const s of slots) {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    }

    for (const date of Object.keys(map)) {
      map[date].sort((a, b) => a.startTime.localeCompare(b.startTime));
    }

    return map;
  }, [slots]);

  //set of all dates that have at least one slot
  const availableDateSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) set.add(s.date);
    return set;
  }, [slots]);

  //local UI state
  //this tracks what date is being browsed and which start time is highlighted
  const [internalSelectedDate, setInternalSelectedDate] = useState<string>("");
  const [internalSelectedStart, setInternalSelectedStart] = useState<string>("");

  //if parent already has a selected value, copy it into local state
  useEffect(() => {
    if (value?.date) {
      setInternalSelectedDate(value.date);
      setInternalSelectedStart(value.startTime || "");
    }
  }, [value?.date, value?.startTime]);

  //currently selected date
  const selectedDate = internalSelectedDate || value?.date || "";

  //keep selected time tied to the currently selected date
  const selectedStartTime =
    selectedDate && value && selectedDate === value.date
      ? value.startTime
      : internalSelectedStart;

  //if a date is already selected, start the calendar on that month
  const initialMonth = useMemo(() => {
    if (selectedDate) {
      const parsed = parseYYYYMMDD(selectedDate);
      if (parsed) return firstDayOfMonth(parsed);
    }
    return minMonth;
  }, [minMonth, selectedDate]);

  const [visibleMonth, setVisibleMonth] = useState<Date>(initialMonth);

  //keeps the displayed month inside the allowed range
  function clampMonth(next: Date) {
    const a = firstDayOfMonth(next).getTime();
    const min = minMonth.getTime();
    const max = maxMonth.getTime();

    if (a < min) return minMonth;
    if (a > max) return maxMonth;
    return firstDayOfMonth(next);
  }

  function goPrevMonth() {
    const prev = addMonths(visibleMonth, -1);
    setVisibleMonth(clampMonth(prev));
  }

  function goNextMonth() {
    const next = addMonths(visibleMonth, 1);
    setVisibleMonth(clampMonth(next));
  }

  function goToCurrentMonth() {
    setVisibleMonth(minMonth);
  }

  const canGoPrev = useMemo(() => {
    return firstDayOfMonth(visibleMonth).getTime() > minMonth.getTime();
  }, [visibleMonth, minMonth]);

  const canGoNext = useMemo(() => {
    return firstDayOfMonth(visibleMonth).getTime() < maxMonth.getTime();
  }, [visibleMonth, maxMonth]);

  //all slot buttons for the selected date
  const selectedSlots = useMemo(() => {
    if (!selectedDate) return [];
    return slotsByDate[selectedDate] ?? [];
  }, [selectedDate, slotsByDate]);

  const handleDayClick: DayClickEventHandler = (day: Date) => {
    const dateKey = toYYYYMMDD(day);

    //ignore clicks on days that do not actually have availability
    if (!availableDateSet.has(dateKey)) return;

    //switching dates clears the selected time
    setInternalSelectedDate(dateKey);
    setInternalSelectedStart("");

    //tell the parent that the user is browsing a new date
    //this lets the reservation form clear its old slot selection too
    onBrowseDateChange?.(dateKey);
  };

  function onTimeClick(slot: SlotCalendarSlot) {
    setInternalSelectedDate(slot.date);
    setInternalSelectedStart(slot.startTime);

    onSelectSlot({
      date: slot.date,
      startTime: slot.startTime,
      slotId: slot.slotId,
    });
  }

  //react-day-picker wants Date objects for modifiers
  const availableDays = useMemo(() => {
    const list: Date[] = [];

    for (const dateKey of availableDateSet) {
      const d = parseYYYYMMDD(dateKey);
      if (d) list.push(d);
    }

    return list;
  }, [availableDateSet]);

  const selectedDayDate = useMemo(() => {
    if (!selectedDate) return undefined;
    const d = parseYYYYMMDD(selectedDate);
    return d ?? undefined;
  }, [selectedDate]);

  return (
    <div className="slotCal">
      <div className="slotCalLeft">
        <div className="slotCalHeader">
          <div className="slotCalHeaderTitle">{monthTitle(visibleMonth)}</div>

          <div className="slotCalHeaderButtons">
            <button
              type="button"
              className="slotCalBtn"
              onClick={goPrevMonth}
              disabled={!canGoPrev}
              aria-disabled={!canGoPrev}
              title="Previous month"
            >
              ←
            </button>

            <button
              type="button"
              className="slotCalBtn"
              onClick={goToCurrentMonth}
              disabled={!canGoPrev}
              aria-disabled={!canGoPrev}
              title="Back to current month"
            >
              Today
            </button>

            <button
              type="button"
              className="slotCalBtn"
              onClick={goNextMonth}
              disabled={!canGoNext}
              aria-disabled={!canGoNext}
              title="Next month"
            >
              →
            </button>
          </div>
        </div>

        <DayPicker
          mode="single"
          month={visibleMonth}
          onMonthChange={(m) => setVisibleMonth(clampMonth(m))}
          selected={selectedDayDate}
          onDayClick={handleDayClick}
          fromMonth={minMonth}
          toMonth={maxMonth}
          disabled={(day) => {
            const dateKey = toYYYYMMDD(day);

            //disable past days only
            if (startOfDay(day).getTime() < today.getTime()) return true;

            //disable dates that have no available slots returned by the backend
            return !availableDateSet.has(dateKey);
          }}
          modifiers={{
            available: availableDays,
          }}
          modifiersClassNames={{
            available: "slotCalDayAvailable",
          }}
          className="slotCalDayPicker"
        />

        <div className="slotCalLegend">
          <div className="slotCalLegendItem">
            <span className="slotCalLegendSwatch slotCalLegendSwatchAvailable" />
            Available day
          </div>
          <div className="slotCalLegendItem">
            <span className="slotCalLegendSwatch slotCalLegendSwatchDisabled" />
            Unavailable day
          </div>
        </div>
      </div>

      <div className="slotCalRight">
        <h3 className="slotCalTimesTitle">Available times</h3>

        {isLoading ? (
          <div className="slotCalHint">Loading slots...</div>
        ) : errorText ? (
          <div className="slotCalError">{errorText}</div>
        ) : !selectedDate ? (
          <div className="slotCalHint">Select a highlighted date to view times.</div>
        ) : selectedSlots.length === 0 ? (
          <div className="slotCalHint">No times for {selectedDate}.</div>
        ) : (
          <div className="slotCalTimesGrid" role="list">
            {selectedSlots.map((s) => {
              const isSelected = selectedDate === s.date && selectedStartTime === s.startTime;

              return (
                <button
                  key={s.slotId}
                  type="button"
                  className={`slotCalTimeBtn ${isSelected ? "slotCalTimeBtnSelected" : ""}`}
                  onClick={() => onTimeClick(s)}
                >
                  {formatTime12Hour(s.startTime)} – {formatTime12Hour(s.endTime)}
                </button>
              );
            })}
          </div>
        )}

        {selectedDate && selectedStartTime ? (
          <div className="slotCalSelectedSummary">
            Selected: <b>{selectedDate}</b> at <b>{formatTime12Hour(selectedStartTime)}</b>
          </div>
        ) : null}
      </div>
    </div>
  );
}
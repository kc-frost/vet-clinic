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
  //defaults to 3 if not passed in
  monthsForward?: number;

  //optional controlled value from the parent
  //if parent passes this in, we mirror it into local state
  value?: SlotCalendarValue | null;

  //callback fired when a time button is clicked
  onSelectSlot: (value: SlotCalendarValue) => void;

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
  //regex here means:
  //^ start of string
  //\d{4} exactly 4 digits
  //- dash
  //\d{2} exactly 2 digits
  //$ end of string
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;

  //slice(start, end) grabs a substring
  //for example slice(0, 4) on 2026-03-08 gives "2026"
  const year = Number(yyyyMmDd.slice(0, 4));
  const month = Number(yyyyMmDd.slice(5, 7));
  const day = Number(yyyyMmDd.slice(8, 10));

  //extra safety checks
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  //js Date months are zero based
  //so january is 0, february is 1, etc
  return new Date(year, month - 1, day);
}

//turns a Date object back into yyyy-mm-dd text
//padStart(2, "0") makes sure month/day always stay 2 digits
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

export default function SlotCalendar({
  slots,
  monthsForward = 2,
  value = null,
  onSelectSlot,
  isLoading = false,
  errorText = "",
}: Props) {
  //today with time zeroed out
  //useMemo here makes sure this value stays stable for the life of the render cycle
  //instead of recreating a brand new Date every time the component rerenders
  const today = useMemo(() => startOfDay(new Date()), []);

  //minimum visible month is the current month
  const minMonth = useMemo(() => firstDayOfMonth(today), [today]);

  //maximum visible month is current month plus however many months forward we allow
  const maxMonth = useMemo(() => addMonths(minMonth, monthsForward), [minMonth, monthsForward]);

  //group all slots by date
  //this lets us answer two questions quickly:
  // does this day have any slots
  // if this day is selected, which slots belong to it
  //
  //Record<string, SlotCalendarSlot[]> means:
  //an object whose keys are strings and whose values are arrays of SlotCalendarSlot
  const slotsByDate = useMemo(() => {
    const map: Record<string, SlotCalendarSlot[]> = {};

    for (const s of slots) {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    }

    //sort times within each date so buttons appear in order
    //localeCompare works well for strings like 09:00 and 10:00
    for (const date of Object.keys(map)) {
      map[date].sort((a, b) => a.startTime.localeCompare(b.startTime));
    }

    return map;
  }, [slots]);

  //set of all dates that have at least one slot
  //Set is useful here because has(...) is fast and clean
  const availableDateSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) set.add(s.date);
    return set;
  }, [slots]);

  //local UI state
  //this component still keeps track of what day the user is browsing,
  //even if the actual selected slot is also being controlled by the parent
  const [internalSelectedDate, setInternalSelectedDate] = useState<string>("");
  const [internalSelectedStart, setInternalSelectedStart] = useState<string>("");

  //if parent passes a selected value, copy it into local state
  //the ?. syntax is optional chaining
  //value?.date means:
  //if value exists, use value.date
  //if value is null or undefined, just return undefined instead of crashing
  useEffect(() => {
    if (value?.date) {
      setInternalSelectedDate(value.date);
      setInternalSelectedStart(value.startTime || "");
    }
  }, [value?.date, value?.startTime]);

  //currently browsed/selected date
  //priority is local state first, then parent value, then empty string
  const selectedDate = internalSelectedDate || value?.date || "";

  //only highlight a selected time if it belongs to the currently selected date
  //the ternary operator here is:
  //condition ? valueIfTrue : valueIfFalse
  const selectedStartTime =
    selectedDate && value && selectedDate === value.date
      ? value.startTime
      : internalSelectedStart;

  //decide which month the calendar should initially show
  //if a date is already selected, open the calendar to that month
  //otherwise default to current month
  const initialMonth = useMemo(() => {
    if (selectedDate) {
      const parsed = parseYYYYMMDD(selectedDate);
      if (parsed) return firstDayOfMonth(parsed);
    }
    return minMonth;
  }, [minMonth, selectedDate]);

  //which month is currently being displayed in the calendar
  const [visibleMonth, setVisibleMonth] = useState<Date>(initialMonth);

  //makes sure visible month never goes outside our allowed range
  function clampMonth(next: Date) {
    const a = firstDayOfMonth(next).getTime();
    const min = minMonth.getTime();
    const max = maxMonth.getTime();

    if (a < min) return minMonth;
    if (a > max) return maxMonth;
    return firstDayOfMonth(next);
  }

  //move visible calendar one month backward
  function goPrevMonth() {
    const prev = addMonths(visibleMonth, -1);
    setVisibleMonth(clampMonth(prev));
  }

  //move visible calendar one month forward
  function goNextMonth() {
    const next = addMonths(visibleMonth, 1);
    setVisibleMonth(clampMonth(next));
  }

  //jump back to current month
  function goToCurrentMonth() {
    setVisibleMonth(minMonth);
  }

  //used to disable the previous month button
  const canGoPrev = useMemo(() => {
    return firstDayOfMonth(visibleMonth).getTime() > minMonth.getTime();
  }, [visibleMonth, minMonth]);

  //used to disable the next month button
  const canGoNext = useMemo(() => {
    return firstDayOfMonth(visibleMonth).getTime() < maxMonth.getTime();
  }, [visibleMonth, maxMonth]);

  //all slots that belong to the currently selected date
  const selectedSlots = useMemo(() => {
    if (!selectedDate) return [];
    return slotsByDate[selectedDate] ?? [];
  }, [selectedDate, slotsByDate]);

  //react-day-picker gives us the clicked day here
  //DayClickEventHandler is just the library's function type for day clicks
  const handleDayClick: DayClickEventHandler = (day: Date) => {
    const dateKey = toYYYYMMDD(day);

    //ignore clicks on days that do not have any available slots
    if (!availableDateSet.has(dateKey)) return;

    //switching to a new day clears time selection
    //user must click a specific time button next
    setInternalSelectedDate(dateKey);
    setInternalSelectedStart("");
  };

  //called when one of the time buttons is clicked
  //updates local highlight state and also tells the parent what was selected
  function onTimeClick(slot: SlotCalendarSlot) {
    setInternalSelectedDate(slot.date);
    setInternalSelectedStart(slot.startTime);

    onSelectSlot({
      date: slot.date,
      startTime: slot.startTime,
      slotId: slot.slotId,
    });
  }

  //react-day-picker modifiers work with Date objects
  //so we convert all available yyyy-mm-dd strings into Date objects here
  const availableDays = useMemo(() => {
    const list: Date[] = [];

    for (const dateKey of availableDateSet) {
      const d = parseYYYYMMDD(dateKey);
      if (d) list.push(d);
    }

    return list;
  }, [availableDateSet]);

  //selected prop for DayPicker also expects a Date object or undefined
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

            //disable past days
            if (startOfDay(day).getTime() < today.getTime()) return true;

            //disable days that do not exist in the available slot set
            return !availableDateSet.has(dateKey);
          }}
          modifiers={{
            //custom modifier name
            //days in this list get the css class from modifiersClassNames below
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
              //button is selected only if both date and startTime match
              const isSelected = selectedDate === s.date && selectedStartTime === s.startTime;

              return (
                <button
                  key={s.slotId}
                  type="button"
                  className={`slotCalTimeBtn ${isSelected ? "slotCalTimeBtnSelected" : ""}`}
                  onClick={() => onTimeClick(s)}
                >
                  {s.startTime} – {s.endTime}
                </button>
              );
            })}
          </div>
        )}

        {selectedDate && selectedStartTime ? (
          <div className="slotCalSelectedSummary">
            Selected: <b>{selectedDate}</b> at <b>{selectedStartTime}</b>
          </div>
        ) : null}
      </div>
    </div>
  );
}
-- Adaptive schedules: the interval is learnt from completion history.
-- (SQLite stores enums as TEXT, so it needs no migration.)
ALTER TYPE "ScheduleAnchor" ADD VALUE 'ADAPTIVE';

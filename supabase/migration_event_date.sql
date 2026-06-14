-- Migration: give events a proper full date (not just a year).
-- `year` stays as the coarse axis used by the timeline slider; `event_date` is
-- the precise day a gig/release/etc happened, when known. Safe to re-run.

alter table public.events add column if not exists event_date date;

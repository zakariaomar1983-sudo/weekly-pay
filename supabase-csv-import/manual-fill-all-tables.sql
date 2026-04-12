create extension if not exists pgcrypto;
begin;
-- Clear current snapshot
delete from payslips;
delete from truck_expense;
delete from truck_income;
delete from trucks;
delete from drivers;
insert into drivers (id, name, phone, license_number, license_expiry, hire_date, status, address, emergency_contact)
select gen_random_uuid(), v.name, v.phone, v.license_number,
       nullif(v.license_expiry, '')::date,
       nullif(v.hire_date, '')::date,
       v.status, v.address, v.emergency_contact
from (values
('Sharmake Hashi', '0491281244', '044174377', '2027-12-04', '2025-04-10', 'Active', 'U 3 28 Hopetoun St, Moonee Ponds 3039', ''),
('Imran Abdella', '0402584147', '045645234', '2026-09-06', '2025-03-14', 'Active', '49 Coronado Way, Tarneit 3029', ''),
('Abdirizak Ahmed', '0423079397', '013808589', '2026-01-23', '2023-06-21', 'Active', '534 Waterdale Rd, Heidelberg Heights 3081', ''),
('Ramzi Mohamed', '0481167950', '046498510', '2027-06-15', '2023-06-10', 'Active', 'U 208/495 Cardigan St, Carlton 3053', ''),
('Suhen Omar', '0402088690', '093229771', '2026-07-06', '2022-02-10', 'Active', '22 Langford Rd, Donnybrook 3064', ''),
('Soleh Sungkar', '0403359047', '022041320', '2027-01-20', '2025-07-23', 'Active', '3 Triandra Dr, Brookfield 3338', ''),
('Samatar Yusuf', '0412549653', '020194901', '2026-04-26', '2025-07-10', 'Active', '12 Derby Dr, Epping 3076', '')
) as v(name, phone, license_number, license_expiry, hire_date, status, address, emergency_contact);
insert into trucks (id, truck_number, registration, model, capacity, service_due_date, rego_expiry_date, status, notes)
select gen_random_uuid(), v.truck_number, v.registration, v.model,
       nullif(v.capacity, '')::numeric,
       nullif(v.service_due_date, '')::date,
       nullif(v.rego_expiry_date, '')::date,
       v.status, v.notes
from (values
('840', 'XW46EK', 'ISUZU FVL  1400', '8', '2026-04-10', '2026-04-29', 'Available', ''),
('881', 'XW91GW', 'MITSO FUSO FIGHTER 10.0', '12', '2026-04-11', '2027-04-11', 'Available', ''),
('855', 'XW64YE', 'Hino GD184R-Q3', '12', '2026-04-24', '2026-04-26', 'Available', ''),
('853', 'XW40BN', 'ISUZU FVL 1400', '12', '2026-05-14', '2026-07-02', 'Available', ''),
('672', '1DK3DE', 'MITSUBISHI FIGHTER', '6', '2026-04-30', '2026-07-24', 'Available', ''),
('620', '1KF3MA', 'MITSUBISHI FUSO FIGHTER 6.0', '6', '2026-04-30', '2026-09-18', 'Available', ''),
('841', 'XV90EH', 'HINO', '8', '2026-07-01', '2026-08-11', 'Available', '')
) as v(truck_number, registration, model, capacity, service_due_date, rego_expiry_date, status, notes)
where nullif(v.truck_number, '') is not null;
insert into truck_income (id, income_date, truck_number, job_ref, client, amount, status, notes)
select gen_random_uuid(),
       nullif(v.income_date, '')::date,
       v.truck_number, v.job_ref, v.client,
       nullif(v.amount, '')::numeric,
       v.status, v.notes
from (values
('2026-04-09', '881', 'LG001', 'LG', '3749.91', 'Paid', ''),
('2026-04-09', '853', 'LG001', 'LG', '5040.47', 'Paid', ''),
('2026-04-09', '855', 'LG001', 'LG', '3288.37', 'Paid', ''),
('2026-04-09', '841', 'LG001', 'LG', '3902.24', 'Paid', ''),
('2026-04-09', '840', 'LG001', 'LG', '3440.94', 'Paid', ''),
('2026-04-09', '672', 'LG001', 'LG', '1860.01', 'Paid', ''),
('2026-04-09', '620', 'LG001', 'LG', '2643.11', 'Paid', '')
) as v(income_date, truck_number, job_ref, client, amount, status, notes)
where nullif(v.truck_number, '') is not null;
insert into truck_expense (id, expense_date, truck_number, category, amount, vendor, notes)
select gen_random_uuid(),
       nullif(v.expense_date, '')::date,
       v.truck_number, v.category,
       nullif(v.amount, '')::numeric,
       v.vendor, v.notes
from (values
('2026-04-09', '855', 'FUEL', '250', 'BP', ''),
('2026-04-09', '840', 'FUEL', '1315', 'BP', ''),
('2026-04-09', '853', 'FUEL', '1090.85', 'BP', ''),
('2026-04-09', '881', 'FUEL', '599', 'BP', ''),
('2026-04-09', '841', 'FUEL', '470.15', 'BP', ''),
('2026-04-09', '672', 'FUEL', '498.51', 'BP', ''),
('2026-04-09', '620', 'FUEL', '600.01', 'BP', ''),
('2026-04-09', '840', 'RENTAL', '850', 'IAN', ''),
('2026-04-09', '881', 'RENTAL', '500', 'IAN', ''),
('2026-04-09', '853', 'AYUUTO', '625', 'HAMIDO', 'ZAKY''S AYUUTO'),
('2026-04-09', '841', 'AYUUTO', '937.5', 'HAMIDO', 'RAMZI''S AYUUTO'),
('2026-04-09', '620', 'AYUUTO', '312.5', 'HAMIDO', 'SUHEN''S AYUUTO'),
('2026-04-02', '853', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-02', '881', 'TOLL', '20', 'LINKT', ''),
('2026-04-02', '620', 'TOLL', '20', 'LINK', ''),
('2026-04-02', '881', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-02', '881', 'TOLL', '10', 'LINKT', ''),
('2026-04-02', '881', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-02', '855', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-02', '855', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-07', '853', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-07', '840', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-07', '881', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-07', '855', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-07', '672', 'TOLL', '20', 'LINKT', ''),
('2026-04-08', '855', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-08', '672', 'TOLL', '20', 'LINKT', ''),
('2026-04-08', '855', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-08', '853', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-08', '672', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-08', '881', 'TOLL', '37.53', 'LINKT', ''),
('2026-04-09', '853', 'INSURANCE', '75.51', 'QBE', ''),
('2026-04-09', '855', 'INSURANCE', '75.51', 'QBE', ''),
('2026-04-09', '881', 'INSURANCE', '75.51', 'QBE', ''),
('2026-04-09', '840', 'INSURANCE', '75.51', 'QBE', ''),
('2026-04-09', '841', 'INSURANCE', '75.51', 'QBE', ''),
('2026-04-09', '672', 'INSURANCE', '75.51', 'QBE', ''),
('2026-04-09', '620', 'INSURANCE', '75.51', 'QBE', ''),
('2026-04-10', '620', 'FUEL', '484.68', 'BP', ''),
('2026-04-10', '672', 'FUEL', '418.81', 'BP', ''),
('2026-04-10', '881', 'FUEL', '616.22', 'BP', ''),
('2026-04-09', '855', 'FUEL', '388.49', 'BP', ''),
('2026-04-11', '881', 'Registration', '1850.6', 'Vicroads', '')
) as v(expense_date, truck_number, category, amount, vendor, notes)
where nullif(v.truck_number, '') is not null;
insert into payslips (id, driver, truck_number, pay_period, days_worked, daily_rate, night_run_drops, drop_rate, night_run_pay, driver_bonus, deductions, payment_date, auto_pay, auto_pay_ref)
select gen_random_uuid(),
       v.driver, v.truck_number, v.pay_period,
       nullif(v.days_worked, '')::numeric,
       nullif(v.daily_rate, '')::numeric,
       nullif(v.night_run_drops, '')::int,
       nullif(v.drop_rate, '')::numeric,
       nullif(v.night_run_pay, '')::numeric,
       nullif(v.driver_bonus, '')::numeric,
       nullif(v.deductions, '')::numeric,
       nullif(v.payment_date, '')::date,
       v.auto_pay, v.auto_pay_ref
from (values
('ABDIRIZAK AHMED', '853', '02APR - 08APR', '4', '330', '2', '90', '180', '400', '725', '2026-04-09', 'No', ''),
('IMRAN ABEDLLA', '881', '02APR - 08APR', '4', '330', '0', '90', '0', '0', '0', '2026-04-09', 'No', ''),
('SAMATAR YUSUF', '855', '02APR - 08APR', '3', '330', '1', '90', '90', '0', '0', '2026-04-09', 'No', ''),
('RAMZI MOHAMED', '841', '02APR - 08APR', '4', '325', '0', '90', '0', '100', '937.5', '2026-04-09', 'No', ''),
('SOLEH SUNKGOR', '840', '02APR - 08APR', '4', '325', '0', '90', '0', '160', '0', '2026-04-09', 'No', ''),
('SHARMAKE HASHI', '672', '02APR - 08APR', '3', '320', '0', '90', '0', '0', '0', '2026-04-09', 'No', ''),
('SUHEN OMAR', '620', '02APR - 08APR', '4', '320', '0', '90', '0', '0', '470.5', '2026-04-09', 'No', ''),
('DAUD Q', '001', '02APR - 08APR', '5', '200', '0', '90', '0', '0', '0', '2026-04-09', 'No', ''),
('Axmed Aaden', '002', '02APR - 08APR', '4', '200', '0', '90', '0', '0', '0', '2026-04-09', 'No', '')
) as v(driver, truck_number, pay_period, days_worked, daily_rate, night_run_drops, drop_rate, night_run_pay, driver_bonus, deductions, payment_date, auto_pay, auto_pay_ref)
where nullif(v.truck_number, '') is not null;
commit;
select
  (select count(*) from drivers) as drivers,
  (select count(*) from trucks) as trucks,
  (select count(*) from truck_income) as truck_income,
  (select count(*) from truck_expense) as truck_expense,
  (select count(*) from payslips) as payslips;

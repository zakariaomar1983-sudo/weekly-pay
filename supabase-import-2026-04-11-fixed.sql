-- Fixed import (quoted camelCase JSON keys)
-- Generated from C:\Users\zakar\Downloads\onpoint-backup-2026-04-11T12-04-04-963Z.json
-- Date generated: 2026-04-12 19:47:59

create extension if not exists pgcrypto;

begin;

delete from drivers;
delete from trucks;
delete from truck_income;
delete from truck_expense;
delete from payslips;

insert into drivers (
  id, name, phone, email, license_number, license_expiry, hire_date, status, address, emergency_contact
)
select
  gen_random_uuid(),
  x.name,
  x.phone,
  coalesce(x.email, ''),
  x."licenseNumber",
  nullif(x."licenseExpiry", '')::date,
  nullif(x."hireDate", '')::date,
  x.status,
  coalesce(x.address, ''),
  coalesce(x."emergencyContact", '')
from jsonb_to_recordset(
  $json$[{"id":"1775820074347_sxyipm","name":"Sharmake Hashi","phone":"0491281244","licenseNumber":"044174377","licenseExpiry":"2027-12-04","hireDate":"2025-04-10","status":"Active","address":"U 3 28 Hopetoun St, Moonee Ponds 3039","emergencyContact":""},{"id":"1775820297067_lz5hji","name":"Imran Abdella","phone":"0402584147","licenseNumber":"045645234","licenseExpiry":"2026-09-06","hireDate":"2025-03-14","status":"Active","address":"49 Coronado Way, Tarneit 3029","emergencyContact":""},{"id":"1775820715258_tptue1","name":"Abdirizak Ahmed","phone":"0423079397","licenseNumber":"013808589","licenseExpiry":"2026-01-23","hireDate":"2023-06-21","status":"Active","address":"534 Waterdale Rd, Heidelberg Heights 3081","emergencyContact":""},{"id":"1775820904200_ibbso0","name":"Ramzi Mohamed","phone":"0481167950","licenseNumber":"046498510","licenseExpiry":"2027-06-15","hireDate":"2023-06-10","status":"Active","address":"U 208/495 Cardigan St, Carlton 3053","emergencyContact":""},{"id":"1775821049272_zi1rao","name":"Suhen Omar","phone":"0402088690","licenseNumber":"093229771","licenseExpiry":"2026-07-06","hireDate":"2022-02-10","status":"Active","address":"22 Langford Rd, Donnybrook 3064","emergencyContact":""},{"id":"1775821268183_arlx7m","name":"Soleh Sungkar","phone":"0403359047","licenseNumber":"022041320","licenseExpiry":"2027-01-20","hireDate":"2025-07-23","status":"Active","address":"3 Triandra Dr, Brookfield 3338","emergencyContact":""},{"id":"1775821405101_be5ebl","name":"Samatar Yusuf","phone":"0412549653","licenseNumber":"020194901","licenseExpiry":"2026-04-26","hireDate":"2025-07-10","status":"Active","address":"12 Derby Dr, Epping 3076","emergencyContact":""}]$json$::jsonb
) as x(
  id text,
  name text,
  phone text,
  email text,
  "licenseNumber" text,
  "licenseExpiry" text,
  "hireDate" text,
  status text,
  address text,
  "emergencyContact" text
);

insert into trucks (
  id, truck_number, registration, model, capacity, service_due_date, rego_expiry_date, status, notes
)
select
  gen_random_uuid(),
  x."truckNumber",
  x.registration,
  x.model,
  coalesce(x.capacity, 0)::numeric,
  nullif(x."serviceDueDate", '')::date,
  nullif(x."regoExpiryDate", '')::date,
  x.status,
  coalesce(x.notes, '')
from jsonb_to_recordset(
  $json$[{"id":"1775787271408_p9dy30","truckNumber":"840","registration":"XW46EK","model":"ISUZU FVL  1400","capacity":8,"serviceDueDate":"2026-04-10","regoExpiryDate":"2026-04-29","status":"Available","notes":""},{"id":"1775787370883_sf5dr8","truckNumber":"881","registration":"XW91GW","model":"MITSO FUSO FIGHTER 10.0","capacity":12,"serviceDueDate":"2026-04-11","regoExpiryDate":"2027-04-11","status":"Available","notes":""},{"id":"1775787429430_gg0i8i","truckNumber":"855","registration":"XW64YE","model":"Hino GD184R-Q3","capacity":12,"serviceDueDate":"2026-04-24","regoExpiryDate":"2026-04-26","status":"Available","notes":""},{"id":"1775787494379_bdqzmi","truckNumber":"853","registration":"XW40BN","model":"ISUZU FVL 1400","capacity":12,"serviceDueDate":"2026-05-14","regoExpiryDate":"2026-07-02","status":"Available","notes":""},{"id":"1775787552585_omnldv","truckNumber":"672","registration":"1DK3DE","model":"MITSUBISHI FIGHTER","capacity":6,"serviceDueDate":"2026-04-30","regoExpiryDate":"2026-07-24","status":"Available","notes":""},{"id":"1775787630878_ihwpq5","truckNumber":"620","registration":"1KF3MA","model":"MITSUBISHI FUSO FIGHTER 6.0","capacity":6,"serviceDueDate":"2026-04-30","regoExpiryDate":"2026-09-18","status":"Available","notes":""},{"id":"1775787684258_7gjqvb","truckNumber":"841","registration":"XV90EH","model":"HINO","capacity":8,"serviceDueDate":"2026-07-01","regoExpiryDate":"2026-08-11","status":"Available","notes":""}]$json$::jsonb
) as x(
  id text,
  "truckNumber" text,
  registration text,
  model text,
  capacity numeric,
  "serviceDueDate" text,
  "regoExpiryDate" text,
  status text,
  notes text
);

insert into truck_income (
  id, income_date, truck_number, job_ref, client, amount, status, notes
)
select
  gen_random_uuid(),
  nullif(x."incomeDate", '')::date,
  x."truckNumber",
  x."jobRef",
  x.client,
  coalesce(x.amount, 0)::numeric,
  x.status,
  coalesce(x.notes, '')
from jsonb_to_recordset(
  $json$[{"id":"1775825534620_3reiah","incomeDate":"2026-04-09","truckNumber":"881","jobRef":"LG001","client":"LG","amount":3749.91,"status":"Paid","notes":""},{"id":"1775825601334_8rphxr","incomeDate":"2026-04-09","truckNumber":"853","jobRef":"LG001","client":"LG","amount":5040.47,"status":"Paid","notes":""},{"id":"1775825644037_n1o11t","incomeDate":"2026-04-09","truckNumber":"855","jobRef":"LG001","client":"LG","amount":3288.37,"status":"Paid","notes":""},{"id":"1775825698496_9mbjsw","incomeDate":"2026-04-09","truckNumber":"841","jobRef":"LG001","client":"LG","amount":3902.24,"status":"Paid","notes":""},{"id":"1775825767687_l2zfxt","incomeDate":"2026-04-09","truckNumber":"840","jobRef":"LG001","client":"LG","amount":3440.94,"status":"Paid","notes":""},{"id":"1775825815967_ly93hl","incomeDate":"2026-04-09","truckNumber":"672","jobRef":"LG001","client":"LG","amount":1860.01,"status":"Paid","notes":""},{"id":"1775825861867_mdgv90","incomeDate":"2026-04-09","truckNumber":"620","jobRef":"LG001","client":"LG","amount":2643.11,"status":"Paid","notes":""}]$json$::jsonb
) as x(
  id text,
  "incomeDate" text,
  "truckNumber" text,
  "jobRef" text,
  client text,
  amount numeric,
  status text,
  notes text
);

insert into truck_expense (
  id, expense_date, truck_number, category, amount, vendor, notes
)
select
  gen_random_uuid(),
  nullif(x.date, '')::date,
  x."truckNumber",
  x.category,
  coalesce(x.amount, 0)::numeric,
  x.vendor,
  coalesce(x.notes, '')
from jsonb_to_recordset(
  $json$[{"id":"1775825935511_tqucf2","date":"2026-04-09","truckNumber":"855","category":"FUEL","amount":250,"vendor":"BP","notes":""},{"id":"1775825972135_0oypxc","date":"2026-04-09","truckNumber":"840","category":"FUEL","amount":1315,"vendor":"BP","notes":""},{"id":"1775826019319_3akp3q","date":"2026-04-09","truckNumber":"853","category":"FUEL","amount":1090.85,"vendor":"BP","notes":""},{"id":"1775826067364_mdzg0r","date":"2026-04-09","truckNumber":"881","category":"FUEL","amount":599,"vendor":"BP","notes":""},{"id":"1775826134943_kamudt","date":"2026-04-09","truckNumber":"841","category":"FUEL","amount":470.15,"vendor":"BP","notes":""},{"id":"1775826181233_cs4c2a","date":"2026-04-09","truckNumber":"672","category":"FUEL","amount":498.51,"vendor":"BP","notes":""},{"id":"1775826218981_9dth61","date":"2026-04-09","truckNumber":"620","category":"FUEL","amount":600.01,"vendor":"BP","notes":""},{"id":"1775827208368_pyp4zy","date":"2026-04-09","truckNumber":"840","category":"RENTAL","amount":850,"vendor":"IAN","notes":""},{"id":"1775827247369_16948v","date":"2026-04-09","truckNumber":"881","category":"RENTAL","amount":500,"vendor":"IAN","notes":""},{"id":"1775828894745_slyh2p","date":"2026-04-09","truckNumber":"853","category":"AYUUTO","amount":625,"vendor":"HAMIDO","notes":"ZAKY'S AYUUTO"},{"id":"1775829003094_5qvx4m","date":"2026-04-09","truckNumber":"841","category":"AYUUTO","amount":937.5,"vendor":"HAMIDO","notes":"RAMZI'S AYUUTO"},{"id":"1775829211169_0mw2l9","date":"2026-04-09","truckNumber":"620","category":"AYUUTO","amount":312.5,"vendor":"HAMIDO","notes":"SUHEN'S AYUUTO"},{"id":"1775841393756_hfvr1w","date":"2026-04-02","truckNumber":"853","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775841496378_ihf7qi","date":"2026-04-02","truckNumber":"881","category":"TOLL","amount":20,"vendor":"LINKT","notes":""},{"id":"1775841552116_pjutfr","date":"2026-04-02","truckNumber":"620","category":"TOLL","amount":20,"vendor":"LINK","notes":""},{"id":"1775841904917_r3q1q4","date":"2026-04-02","truckNumber":"881","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775842159689_tejlez","date":"2026-04-02","truckNumber":"881","category":"TOLL","amount":10,"vendor":"LINKT","notes":""},{"id":"1775861003436_murvep","date":"2026-04-02","truckNumber":"881","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775861480711_cx0pzl","date":"2026-04-02","truckNumber":"855","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775861559239_30l7v8","date":"2026-04-02","truckNumber":"855","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775861676763_4bfh2m","date":"2026-04-07","truckNumber":"853","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775861743461_gi06zf","date":"2026-04-07","truckNumber":"840","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775861788432_n0gry8","date":"2026-04-07","truckNumber":"881","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775862270898_tzdns9","date":"2026-04-07","truckNumber":"855","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775862384248_8tr3fb","date":"2026-04-07","truckNumber":"672","category":"TOLL","amount":20,"vendor":"LINKT","notes":""},{"id":"1775862426959_slt5bd","date":"2026-04-08","truckNumber":"855","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775863544753_0rae64","date":"2026-04-08","truckNumber":"672","category":"TOLL","amount":20,"vendor":"LINKT","notes":""},{"id":"1775863602482_wv6lr6","date":"2026-04-08","truckNumber":"855","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775863744120_pz6zov","date":"2026-04-08","truckNumber":"853","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775863807392_rsrjhq","date":"2026-04-08","truckNumber":"672","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775863859292_hp3zss","date":"2026-04-08","truckNumber":"881","category":"TOLL","amount":37.53,"vendor":"LINKT","notes":""},{"id":"1775866410382_sh0aaj","date":"2026-04-09","truckNumber":"853","category":"INSURANCE","amount":75.51,"vendor":"QBE","notes":""},{"id":"1775866435160_n4dtsd","date":"2026-04-09","truckNumber":"855","category":"INSURANCE","amount":75.51,"vendor":"QBE","notes":""},{"id":"1775866483281_hztyyw","date":"2026-04-09","truckNumber":"881","category":"INSURANCE","amount":75.51,"vendor":"QBE","notes":""},{"id":"1775866504245_85of05","date":"2026-04-09","truckNumber":"840","category":"INSURANCE","amount":75.51,"vendor":"QBE","notes":""},{"id":"1775866523587_6rueq5","date":"2026-04-09","truckNumber":"841","category":"INSURANCE","amount":75.51,"vendor":"QBE","notes":""},{"id":"1775866556803_i7hwh3","date":"2026-04-09","truckNumber":"672","category":"INSURANCE","amount":75.51,"vendor":"QBE","notes":""},{"id":"1775866570216_k8v704","date":"2026-04-09","truckNumber":"620","category":"INSURANCE","amount":75.51,"vendor":"QBE","notes":""},{"id":"1775871938707_jp9dqf","date":"2026-04-10","truckNumber":"620","category":"FUEL","amount":484.68,"vendor":"BP","notes":""},{"id":"1775871965663_4fhx3f","date":"2026-04-10","truckNumber":"672","category":"FUEL","amount":418.81,"vendor":"BP","notes":""},{"id":"1775872004994_of8ctt","date":"2026-04-10","truckNumber":"881","category":"FUEL","amount":616.22,"vendor":"BP","notes":""},{"id":"1775872044954_728vf0","date":"2026-04-09","truckNumber":"855","category":"FUEL","amount":388.49,"vendor":"BP","notes":""},{"id":"1775889635064_58sp89","date":"2026-04-11","truckNumber":"881","category":"Registration","amount":1850.6,"vendor":"Vicroads","notes":""}]$json$::jsonb
) as x(
  id text,
  date text,
  "truckNumber" text,
  category text,
  amount numeric,
  vendor text,
  notes text
);

insert into payslips (
  id, driver, truck_number, pay_period, days_worked, daily_rate, night_run_drops, drop_rate, night_run_pay,
  driver_bonus, deductions, payment_date, auto_pay, auto_pay_ref
)
select
  gen_random_uuid(),
  x.driver,
  x."truckNumber",
  x."payPeriod",
  coalesce(x."daysWorked", 0)::numeric,
  coalesce(x."dailyRate", 0)::numeric,
  coalesce(x."nightRunDrops", 0)::int,
  coalesce(x."dropRate", 90)::numeric,
  coalesce(x."nightRunPay", 0)::numeric,
  coalesce(x."driverBonus", 0)::numeric,
  coalesce(x.deductions, 0)::numeric,
  nullif(x."paymentDate", '')::date,
  coalesce(x."autoPay", 'No'),
  coalesce(x."autoPayRef", '')
from jsonb_to_recordset(
  $json$[{"id":"1775826550019_632e7q","driver":"ABDIRIZAK AHMED","truckNumber":"853","payPeriod":"02APR - 08APR","daysWorked":4,"dailyRate":330,"nightRunDrops":2,"dropRate":90,"nightRunPay":180,"driverBonus":400,"deductions":725,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""},{"id":"1775826692899_ascnf0","driver":"IMRAN ABEDLLA","truckNumber":"881","payPeriod":"02APR - 08APR","daysWorked":4,"dailyRate":330,"nightRunDrops":0,"dropRate":90,"nightRunPay":0,"driverBonus":0,"deductions":0,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""},{"id":"1775826763344_xifn1d","driver":"SAMATAR YUSUF","truckNumber":"855","payPeriod":"02APR - 08APR","daysWorked":3,"dailyRate":330,"nightRunDrops":1,"dropRate":90,"nightRunPay":90,"driverBonus":0,"deductions":0,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""},{"id":"1775826812835_3cc7dr","driver":"RAMZI MOHAMED","truckNumber":"841","payPeriod":"02APR - 08APR","daysWorked":4,"dailyRate":325,"nightRunDrops":0,"dropRate":90,"nightRunPay":0,"driverBonus":100,"deductions":937.5,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""},{"id":"1775826901631_rktdhs","driver":"SOLEH SUNKGOR","truckNumber":"840","payPeriod":"02APR - 08APR","daysWorked":4,"dailyRate":325,"nightRunDrops":0,"dropRate":90,"nightRunPay":0,"driverBonus":160,"deductions":0,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""},{"id":"1775826981155_1s8k4e","driver":"SHARMAKE HASHI","truckNumber":"672","payPeriod":"02APR - 08APR","daysWorked":3,"dailyRate":320,"nightRunDrops":0,"dropRate":90,"nightRunPay":0,"driverBonus":0,"deductions":0,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""},{"id":"1775827140695_51m454","driver":"SUHEN OMAR","truckNumber":"620","payPeriod":"02APR - 08APR","daysWorked":4,"dailyRate":320,"nightRunDrops":0,"dropRate":90,"nightRunPay":0,"driverBonus":0,"deductions":470.5,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""},{"id":"1775866935414_9fguda","driver":"DAUD Q","truckNumber":"001","payPeriod":"02APR - 08APR","daysWorked":5,"dailyRate":200,"nightRunDrops":0,"dropRate":90,"nightRunPay":0,"driverBonus":0,"deductions":0,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""},{"id":"1775867239829_oqw41f","driver":"Axmed Aaden","truckNumber":"002","payPeriod":"02APR - 08APR","daysWorked":4,"dailyRate":200,"nightRunDrops":0,"dropRate":90,"nightRunPay":0,"driverBonus":0,"deductions":0,"paymentDate":"2026-04-09","autoPay":"No","autoPayRef":""}]$json$::jsonb
) as x(
  id text,
  driver text,
  "truckNumber" text,
  "payPeriod" text,
  "daysWorked" numeric,
  "dailyRate" numeric,
  "nightRunDrops" int,
  "dropRate" numeric,
  "nightRunPay" numeric,
  "driverBonus" numeric,
  deductions numeric,
  "paymentDate" text,
  "autoPay" text,
  "autoPayRef" text
);

commit;

begin;

delete from trucks;

insert into trucks (truck_number, registration, model, capacity, service_due_date, rego_expiry_date, status, notes) values
('840','XW46EK','ISUZU FVL  1400',8,'2026-04-10','2026-04-29','Available',''),
('881','XW91GW','MITSO FUSO FIGHTER 10.0',12,'2026-04-11','2027-04-11','Available',''),
('855','XW64YE','Hino GD184R-Q3',12,'2026-04-24','2026-04-26','Available',''),
('853','XW40BN','ISUZU FVL 1400',12,'2026-05-14','2026-07-02','Available',''),
('672','1DK3DE','MITSUBISHI FIGHTER',6,'2026-04-30','2026-07-24','Available',''),
('620','1KF3MA','MITSUBISHI FUSO FIGHTER 6.0',6,'2026-04-30','2026-09-18','Available',''),
('841','XV90EH','HINO',8,'2026-07-01','2026-08-11','Available','');

commit;

-- Any signed-in role can report a fault. Work on the queue stays with maintenance.
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'maintenance.report' FROM role r
ON CONFLICT DO NOTHING;

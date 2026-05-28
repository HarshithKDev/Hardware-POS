-- Create the audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    action_type text NOT NULL,
    barcode text NOT NULL,
    item_name text NOT NULL,
    changes text NOT NULL,
    performed_by text NOT NULL
);

-- Enable RLS and add basic policy for access (assuming anon access for now, like inventory)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for audit_logs" 
ON audit_logs FOR ALL 
USING (true) WITH CHECK (true);

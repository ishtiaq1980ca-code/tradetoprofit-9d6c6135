CREATE POLICY "tokens claim or own update" ON public.license_tokens
FOR UPDATE TO authenticated
USING (user_id IS NULL OR user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
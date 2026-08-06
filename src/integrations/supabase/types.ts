export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_snapshots: {
        Row: {
          balance: number
          bridge_version: number | null
          company: string | null
          created_at: string
          currency: string | null
          daily_pnl: number
          equity: number
          free_margin: number
          id: string
          leverage: number | null
          login: string | null
          margin: number
          mode: string
          name: string | null
          open_positions: number
          server: string | null
          user_id: string | null
        }
        Insert: {
          balance: number
          bridge_version?: number | null
          company?: string | null
          created_at?: string
          currency?: string | null
          daily_pnl?: number
          equity: number
          free_margin?: number
          id?: string
          leverage?: number | null
          login?: string | null
          margin?: number
          mode?: string
          name?: string | null
          open_positions?: number
          server?: string | null
          user_id?: string | null
        }
        Update: {
          balance?: number
          bridge_version?: number | null
          company?: string | null
          created_at?: string
          currency?: string | null
          daily_pnl?: number
          equity?: number
          free_margin?: number
          id?: string
          leverage?: number | null
          login?: string | null
          margin?: number
          mode?: string
          name?: string | null
          open_positions?: number
          server?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      backtest_runs: {
        Row: {
          created_at: string
          end_balance: number
          equity_curve: Json
          id: string
          losses: number
          max_drawdown: number
          net_profit: number
          params: Json
          profit_factor: number
          start_balance: number
          symbol: string
          total_trades: number
          user_id: string | null
          win_rate: number
          wins: number
        }
        Insert: {
          created_at?: string
          end_balance: number
          equity_curve: Json
          id?: string
          losses: number
          max_drawdown: number
          net_profit: number
          params: Json
          profit_factor: number
          start_balance: number
          symbol: string
          total_trades: number
          user_id?: string | null
          win_rate: number
          wins: number
        }
        Update: {
          created_at?: string
          end_balance?: number
          equity_curve?: Json
          id?: string
          losses?: number
          max_drawdown?: number
          net_profit?: number
          params?: Json
          profit_factor?: number
          start_balance?: number
          symbol?: string
          total_trades?: number
          user_id?: string | null
          win_rate?: number
          wins?: number
        }
        Relationships: []
      }
      bot_settings: {
        Row: {
          account_mode: string
          adx_min: number
          atr_period: number
          atr_sl_mult: number
          atr_tp_mult: number
          created_at: string
          daily_profit_target: number
          ema_fast: number
          ema_slow: number
          enabled: boolean
          id: number
          max_daily_loss: number
          max_spread_pips: number
          min_confidence: number
          partial_close_pct: number
          risk_per_trade: number
          rsi_period: number
          symbols: string[]
          trailing_atr_mult: number
          updated_at: string
        }
        Insert: {
          account_mode?: string
          adx_min?: number
          atr_period?: number
          atr_sl_mult?: number
          atr_tp_mult?: number
          created_at?: string
          daily_profit_target?: number
          ema_fast?: number
          ema_slow?: number
          enabled?: boolean
          id?: number
          max_daily_loss?: number
          max_spread_pips?: number
          min_confidence?: number
          partial_close_pct?: number
          risk_per_trade?: number
          rsi_period?: number
          symbols?: string[]
          trailing_atr_mult?: number
          updated_at?: string
        }
        Update: {
          account_mode?: string
          adx_min?: number
          atr_period?: number
          atr_sl_mult?: number
          atr_tp_mult?: number
          created_at?: string
          daily_profit_target?: number
          ema_fast?: number
          ema_slow?: number
          enabled?: boolean
          id?: number
          max_daily_loss?: number
          max_spread_pips?: number
          min_confidence?: number
          partial_close_pct?: number
          risk_per_trade?: number
          rsi_period?: number
          symbols?: string[]
          trailing_atr_mult?: number
          updated_at?: string
        }
        Relationships: []
      }
      calendar_feed_state: {
        Row: {
          active_source: string | null
          backoff_until: string | null
          event_count: number
          id: number
          last_attempt: string | null
          last_error: string | null
          last_ok: string | null
          updated_at: string
        }
        Insert: {
          active_source?: string | null
          backoff_until?: string | null
          event_count?: number
          id?: number
          last_attempt?: string | null
          last_error?: string | null
          last_ok?: string | null
          updated_at?: string
        }
        Update: {
          active_source?: string | null
          backoff_until?: string | null
          event_count?: number
          id?: number
          last_attempt?: string | null
          last_error?: string | null
          last_ok?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      close_requests: {
        Row: {
          created_at: string
          error: string | null
          executed_at: string | null
          id: string
          kind: string
          leased_at: string | null
          mt5_ticket: number
          reason: string
          side: string
          status: string
          symbol: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          executed_at?: string | null
          id?: string
          kind?: string
          leased_at?: string | null
          mt5_ticket: number
          reason: string
          side: string
          status?: string
          symbol: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          executed_at?: string | null
          id?: string
          kind?: string
          leased_at?: string | null
          mt5_ticket?: number
          reason?: string
          side?: string
          status?: string
          symbol?: string
          user_id?: string | null
        }
        Relationships: []
      }
      economic_events: {
        Row: {
          at: string
          created_at: string
          currency: string
          id: string
          impact: string
          source: string
          title: string
        }
        Insert: {
          at: string
          created_at?: string
          currency: string
          id?: string
          impact: string
          source?: string
          title: string
        }
        Update: {
          at?: string
          created_at?: string
          currency?: string
          id?: string
          impact?: string
          source?: string
          title?: string
        }
        Relationships: []
      }
      execution_log: {
        Row: {
          action: string
          created_at: string
          error: string | null
          id: string
          latency_ms: number | null
          mt5_ticket: number | null
          retcode: number | null
          retry_count: number
          side: string | null
          signal_id: string | null
          symbol: string
        }
        Insert: {
          action: string
          created_at?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          mt5_ticket?: number | null
          retcode?: number | null
          retry_count?: number
          side?: string | null
          signal_id?: string | null
          symbol: string
        }
        Update: {
          action?: string
          created_at?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          mt5_ticket?: number | null
          retcode?: number | null
          retry_count?: number
          side?: string | null
          signal_id?: string | null
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_log_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      license_tokens: {
        Row: {
          broker: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          mt5_account: string | null
          notes: string | null
          redeemed_at: string | null
          status: string
          token: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          broker?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          mt5_account?: string | null
          notes?: string | null
          redeemed_at?: string | null
          status?: string
          token: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          broker?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          mt5_account?: string | null
          notes?: string | null
          redeemed_at?: string | null
          status?: string
          token?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      pair_settings: {
        Row: {
          adx_min: number
          atr_period: number
          atr_sl_mult: number
          created_at: string
          ema_fast: number
          ema_slow: number
          enabled: boolean
          max_lot: number
          max_spread_pct: number
          min_confidence: number
          risk_per_trade_pct: number
          rr_target: number
          rsi_lower: number
          rsi_period: number
          rsi_upper: number
          symbol: string
          updated_at: string
        }
        Insert: {
          adx_min?: number
          atr_period?: number
          atr_sl_mult?: number
          created_at?: string
          ema_fast?: number
          ema_slow?: number
          enabled?: boolean
          max_lot?: number
          max_spread_pct?: number
          min_confidence?: number
          risk_per_trade_pct?: number
          rr_target?: number
          rsi_lower?: number
          rsi_period?: number
          rsi_upper?: number
          symbol: string
          updated_at?: string
        }
        Update: {
          adx_min?: number
          atr_period?: number
          atr_sl_mult?: number
          created_at?: string
          ema_fast?: number
          ema_slow?: number
          enabled?: boolean
          max_lot?: number
          max_spread_pct?: number
          min_confidence?: number
          risk_per_trade_pct?: number
          rr_target?: number
          rsi_lower?: number
          rsi_period?: number
          rsi_upper?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          broker: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          mt5_account: string | null
          updated_at: string
        }
        Insert: {
          broker?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          mt5_account?: string | null
          updated_at?: string
        }
        Update: {
          broker?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          mt5_account?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      signals: {
        Row: {
          confidence: number
          created_at: string
          entry: number
          executed_at: string | null
          id: string
          lot: number
          mt5_ticket: number | null
          reason: string
          risk_pct: number
          side: string
          status: string
          stop_loss: number
          symbol: string
          take_profit: number
        }
        Insert: {
          confidence: number
          created_at?: string
          entry: number
          executed_at?: string | null
          id?: string
          lot: number
          mt5_ticket?: number | null
          reason: string
          risk_pct: number
          side: string
          status?: string
          stop_loss: number
          symbol: string
          take_profit: number
        }
        Update: {
          confidence?: number
          created_at?: string
          entry?: number
          executed_at?: string | null
          id?: string
          lot?: number
          mt5_ticket?: number | null
          reason?: string
          risk_pct?: number
          side?: string
          status?: string
          stop_loss?: number
          symbol?: string
          take_profit?: number
        }
        Relationships: []
      }
      strategies: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          min_confidence: number
          name: string
          notes: string | null
          params: Json
          symbol: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          min_confidence?: number
          name: string
          notes?: string | null
          params?: Json
          symbol?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          min_confidence?: number
          name?: string
          notes?: string | null
          params?: Json
          symbol?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      strategy_adjustments: {
        Row: {
          adjustment: number
          avg_r: number | null
          created_at: string
          dimension: string
          id: string
          note: string | null
          pattern_key: string
          previous_adjustment: number
          sample_size: number
          user_id: string
          win_rate: number | null
        }
        Insert: {
          adjustment: number
          avg_r?: number | null
          created_at?: string
          dimension: string
          id?: string
          note?: string | null
          pattern_key: string
          previous_adjustment?: number
          sample_size?: number
          user_id: string
          win_rate?: number | null
        }
        Update: {
          adjustment?: number
          avg_r?: number | null
          created_at?: string
          dimension?: string
          id?: string
          note?: string | null
          pattern_key?: string
          previous_adjustment?: number
          sample_size?: number
          user_id?: string
          win_rate?: number | null
        }
        Relationships: []
      }
      trade_reviews: {
        Row: {
          adx: number | null
          atr: number | null
          atr_pct: number | null
          behavior: string
          closed_at: string | null
          confidence: number | null
          created_at: string
          duration_sec: number | null
          entry: number | null
          exit: number | null
          htf_trend: string | null
          id: string
          key_level: number | null
          lessons: string | null
          lot: number | null
          mt5_ticket: number | null
          opened_at: string | null
          outcome: string
          pattern_keys: string[]
          pips: number | null
          profit: number | null
          quality_score: number | null
          r_multiple: number | null
          rsi: number | null
          session: string | null
          side: string
          stop_loss: number | null
          strategy: string | null
          structure_note: string | null
          swing: string | null
          symbol: string
          take_profit: number | null
          trade_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          adx?: number | null
          atr?: number | null
          atr_pct?: number | null
          behavior?: string
          closed_at?: string | null
          confidence?: number | null
          created_at?: string
          duration_sec?: number | null
          entry?: number | null
          exit?: number | null
          htf_trend?: string | null
          id?: string
          key_level?: number | null
          lessons?: string | null
          lot?: number | null
          mt5_ticket?: number | null
          opened_at?: string | null
          outcome?: string
          pattern_keys?: string[]
          pips?: number | null
          profit?: number | null
          quality_score?: number | null
          r_multiple?: number | null
          rsi?: number | null
          session?: string | null
          side: string
          stop_loss?: number | null
          strategy?: string | null
          structure_note?: string | null
          swing?: string | null
          symbol: string
          take_profit?: number | null
          trade_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          adx?: number | null
          atr?: number | null
          atr_pct?: number | null
          behavior?: string
          closed_at?: string | null
          confidence?: number | null
          created_at?: string
          duration_sec?: number | null
          entry?: number | null
          exit?: number | null
          htf_trend?: string | null
          id?: string
          key_level?: number | null
          lessons?: string | null
          lot?: number | null
          mt5_ticket?: number | null
          opened_at?: string | null
          outcome?: string
          pattern_keys?: string[]
          pips?: number | null
          profit?: number | null
          quality_score?: number | null
          r_multiple?: number | null
          rsi?: number | null
          session?: string | null
          side?: string
          stop_loss?: number | null
          strategy?: string | null
          structure_note?: string | null
          swing?: string | null
          symbol?: string
          take_profit?: number | null
          trade_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          closed_at: string | null
          entry: number
          exit: number | null
          id: string
          lot: number
          mt5_ticket: number | null
          needs_review: boolean
          opened_at: string
          pips: number | null
          profit: number | null
          reconcile_note: string | null
          reconciled: boolean
          side: string
          signal_id: string | null
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          user_id: string | null
        }
        Insert: {
          closed_at?: string | null
          entry: number
          exit?: number | null
          id?: string
          lot: number
          mt5_ticket?: number | null
          needs_review?: boolean
          opened_at?: string
          pips?: number | null
          profit?: number | null
          reconcile_note?: string | null
          reconciled?: boolean
          side: string
          signal_id?: string | null
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
          user_id?: string | null
        }
        Update: {
          closed_at?: string | null
          entry?: number
          exit?: number | null
          id?: string
          lot?: number
          mt5_ticket?: number | null
          needs_review?: boolean
          opened_at?: string
          pips?: number | null
          profit?: number | null
          reconcile_note?: string | null
          reconciled?: boolean
          side?: string
          signal_id?: string | null
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trades_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_generate_token: {
        Args: { _days?: number; _notes?: string; _token: string }
        Returns: {
          broker: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          mt5_account: string | null
          notes: string | null
          redeemed_at: string | null
          status: string
          token: string
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "license_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_admin_if_none: { Args: never; Returns: boolean }
      flag_stale_open_trades: {
        Args: { _max_age_days?: number }
        Returns: number
      }
      has_active_license: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_users_basic: {
        Args: never
        Returns: {
          active_token: string
          display_name: string
          email: string
          is_admin: boolean
          token_expires_at: string
          user_id: string
        }[]
      }
      redeem_license_token: {
        Args: { _mt5_account?: string; _token: string }
        Returns: {
          broker: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          mt5_account: string | null
          notes: string | null
          redeemed_at: string | null
          status: string
          token: string
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "license_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_bot_enabled: { Args: { _enabled: boolean }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const

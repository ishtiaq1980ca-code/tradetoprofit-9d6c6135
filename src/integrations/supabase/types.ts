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
          created_at: string
          daily_pnl: number
          equity: number
          free_margin: number
          id: string
          margin: number
          mode: string
          open_positions: number
        }
        Insert: {
          balance: number
          created_at?: string
          daily_pnl?: number
          equity: number
          free_margin?: number
          id?: string
          margin?: number
          mode?: string
          open_positions?: number
        }
        Update: {
          balance?: number
          created_at?: string
          daily_pnl?: number
          equity?: number
          free_margin?: number
          id?: string
          margin?: number
          mode?: string
          open_positions?: number
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
      trades: {
        Row: {
          closed_at: string | null
          entry: number
          exit: number | null
          id: string
          lot: number
          mt5_ticket: number | null
          opened_at: string
          pips: number | null
          profit: number | null
          side: string
          signal_id: string | null
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
        }
        Insert: {
          closed_at?: string | null
          entry: number
          exit?: number | null
          id?: string
          lot: number
          mt5_ticket?: number | null
          opened_at?: string
          pips?: number | null
          profit?: number | null
          side: string
          signal_id?: string | null
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
        }
        Update: {
          closed_at?: string | null
          entry?: number
          exit?: number | null
          id?: string
          lot?: number
          mt5_ticket?: number | null
          opened_at?: string
          pips?: number | null
          profit?: number | null
          side?: string
          signal_id?: string | null
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
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

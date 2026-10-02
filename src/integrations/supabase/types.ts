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
      analyses: {
        Row: {
          agent_status: Json | null
          attempt: number
          commit_message: string | null
          commit_sha: string | null
          error: string | null
          finished_at: string | null
          id: string
          repo_id: string
          started_at: string
          status: string
          summary: string | null
          trigger: string
          user_id: string
        }
        Insert: {
          agent_status?: Json | null
          attempt?: number
          commit_message?: string | null
          commit_sha?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          repo_id: string
          started_at?: string
          status?: string
          summary?: string | null
          trigger?: string
          user_id: string
        }
        Update: {
          agent_status?: Json | null
          attempt?: number
          commit_message?: string | null
          commit_sha?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          repo_id?: string
          started_at?: string
          status?: string
          summary?: string | null
          trigger?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_chunks: {
        Row: {
          analysis_id: string
          content: string
          created_at: string
          embedding: string
          id: string
          kind: string
          metadata: Json | null
          source: string
          user_id: string
        }
        Insert: {
          analysis_id: string
          content: string
          created_at?: string
          embedding: string
          id?: string
          kind: string
          metadata?: Json | null
          source: string
          user_id: string
        }
        Update: {
          analysis_id?: string
          content?: string
          created_at?: string
          embedding?: string
          id?: string
          kind?: string
          metadata?: Json | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_chunks_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_jobs: {
        Row: {
          agents: string[] | null
          analysis_id: string | null
          attempts: number
          commit_message: string | null
          commit_sha: string | null
          created_at: string
          id: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          ref: string | null
          repo_id: string
          run_at: string
          status: string
          trigger: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agents?: string[] | null
          analysis_id?: string | null
          attempts?: number
          commit_message?: string | null
          commit_sha?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          ref?: string | null
          repo_id: string
          run_at?: string
          status?: string
          trigger?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agents?: string[] | null
          analysis_id?: string | null
          attempts?: number
          commit_message?: string | null
          commit_sha?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          ref?: string | null
          repo_id?: string
          run_at?: string
          status?: string
          trigger?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_jobs_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      findings: {
        Row: {
          agent: string
          analysis_id: string
          created_at: string
          detail: string | null
          file_path: string | null
          id: string
          metadata: Json | null
          severity: string
          title: string
          user_id: string
        }
        Insert: {
          agent: string
          analysis_id: string
          created_at?: string
          detail?: string | null
          file_path?: string | null
          id?: string
          metadata?: Json | null
          severity?: string
          title: string
          user_id: string
        }
        Update: {
          agent?: string
          analysis_id?: string
          created_at?: string
          detail?: string | null
          file_path?: string | null
          id?: string
          metadata?: Json | null
          severity?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "findings_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_tests: {
        Row: {
          analysis_id: string
          created_at: string
          id: string
          language: string
          source_file: string
          target_function: string | null
          test_code: string
          user_id: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          id?: string
          language?: string
          source_file: string
          target_function?: string | null
          test_code: string
          user_id: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          id?: string
          language?: string
          source_file?: string
          target_function?: string | null
          test_code?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_tests_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      github_tokens: {
        Row: {
          created_at: string
          github_login: string | null
          token_ciphertext: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          github_login?: string | null
          token_ciphertext: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          github_login?: string | null
          token_ciphertext?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      job_events: {
        Row: {
          agent: string | null
          analysis_id: string
          attempt: number
          created_at: string
          duration_ms: number | null
          id: string
          message: string | null
          status: string
          step: string
          user_id: string
        }
        Insert: {
          agent?: string | null
          analysis_id: string
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          id?: string
          message?: string | null
          status?: string
          step: string
          user_id: string
        }
        Update: {
          agent?: string | null
          analysis_id?: string
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          id?: string
          message?: string | null
          status?: string
          step?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_events_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      repos: {
        Row: {
          created_at: string
          default_branch: string
          description: string | null
          github_full_name: string
          id: string
          language: string | null
          last_event_at: string | null
          user_id: string
          webhook_enabled: boolean
          webhook_secret: string | null
        }
        Insert: {
          created_at?: string
          default_branch?: string
          description?: string | null
          github_full_name: string
          id?: string
          language?: string | null
          last_event_at?: string | null
          user_id: string
          webhook_enabled?: boolean
          webhook_secret?: string | null
        }
        Update: {
          created_at?: string
          default_branch?: string
          description?: string | null
          github_full_name?: string
          id?: string
          language?: string | null
          last_event_at?: string | null
          user_id?: string
          webhook_enabled?: boolean
          webhook_secret?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_analysis_jobs: {
        Args: { p_limit?: number }
        Returns: {
          agents: string[] | null
          analysis_id: string | null
          attempts: number
          commit_message: string | null
          commit_sha: string | null
          created_at: string
          id: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          ref: string | null
          repo_id: string
          run_at: string
          status: string
          trigger: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      match_analysis_chunks: {
        Args: {
          p_analysis_id: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          content: string
          id: string
          kind: string
          metadata: Json
          similarity: number
          source: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

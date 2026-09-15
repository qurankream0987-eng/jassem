import { useState, useRef } from "react";
import { X, Plus } from "lucide-react";
import { commonSkills } from "../data/mockJobs";

interface SkillInputProps {
  skills: string[];
  onChange: (skills: string[]) => void;
  placeholder?: string;
}

export default function SkillInput({
  skills,
  onChange,
  placeholder = "أضف مهارة واضغط Enter",
}: SkillInputProps) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAddSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (trimmed && !skills.includes(trimmed)) {
      onChange([...skills, trimmed]);
    }
    setInput("");
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    onChange(skills.filter((s) => s !== skillToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.trim()) {
        handleAddSkill(input);
      }
    } else if (e.key === "Backspace" && !input && skills.length > 0) {
      handleRemoveSkill(skills[skills.length - 1]);
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.trim().length > 0) {
      const filtered = commonSkills
        .filter(
          (s) =>
            s.toLowerCase().includes(value.toLowerCase()) &&
            !skills.includes(s)
        )
        .slice(0, 5);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  return (
    <div className="w-full">
      <div
        className="flex flex-wrap gap-2 p-3 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-xl"
        onClick={() => inputRef.current?.focus()}
      >
        {skills.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-[var(--cyan)]/20 text-[var(--cyan)] border border-[var(--cyan)]/30 backdrop-blur-md transition-all duration-200 hover:bg-[var(--cyan)]/30"
          >
            {skill}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveSkill(skill);
              }}
              className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-[var(--cyan)]/30 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[120px]">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            placeholder={skills.length === 0 ? placeholder : ""}
            className="w-full py-1.5 bg-transparent text-white placeholder:text-white/40 outline-none text-sm"
            dir="rtl"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 top-full right-0 mt-1 w-56 rounded-xl border border-white/20 bg-black/80 backdrop-blur-xl shadow-2xl overflow-hidden">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleAddSkill(suggestion);
                  }}
                  className="w-full text-right px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-[var(--cyan)] transition-colors flex items-center gap-2"
                  dir="rtl"
                >
                  <Plus className="w-3 h-3 shrink-0" />
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {skills.length === 0 && (
        <p className="text-xs text-white/30 mt-1.5 mr-1" dir="rtl">
          اكتب مهارة واضغط Enter للإضافة
        </p>
      )}
    </div>
  );
}

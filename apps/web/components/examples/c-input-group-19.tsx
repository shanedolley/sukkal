"use client"

import { useState } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { AtSignIcon, PaperclipIcon, FileTextIcon, ChevronDownIcon, ImageIcon, CornerDownLeftIcon } from "lucide-react"

export function Pattern() {
  const [model, setModel] = useState("GPT-4o")

  return (
    <Field className="max-w-xs">
      <InputGroup className="bg-background">
        <InputGroupAddon align="block-start" className="gap-2 px-3 pt-3">
          <InputGroupButton variant="outline" size="icon-xs">
            <AtSignIcon className="size-3.5" />
          </InputGroupButton>
          <InputGroupButton variant="outline">
            <PaperclipIcon className="size-3.5 not-only:rotate-45" />
            1
          </InputGroupButton>
          <InputGroupButton variant="outline">
            <FileTextIcon className="size-3.5 not-only:rotate-45" />
            1 Tab
          </InputGroupButton>
        </InputGroupAddon>

        <InputGroupTextarea
          placeholder="Plan, search, build anything"
          className="min-h-24 border-none py-4 shadow-none focus-visible:ring-0"
        />

        <InputGroupAddon align="block-end" className="px-3 pb-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<InputGroupButton variant="secondary" size="sm" />}
            >
              {model}
              <ChevronDownIcon
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setModel("GPT-4o")}>
                GPT-4o
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setModel("Claude 3.5 Sonnet")}>
                Claude 3.5 Sonnet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex items-center gap-2">
            <InputGroupButton variant="secondary" size="icon-sm">
              <ImageIcon className="text-muted-foreground" />
            </InputGroupButton>
            <InputGroupButton variant="default" size="icon-sm">
              <CornerDownLeftIcon
              />
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}
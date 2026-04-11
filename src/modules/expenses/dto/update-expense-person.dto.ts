import { PartialType } from '@nestjs/mapped-types';
import { CreateExpensePersonDto } from './create-expense-person.dto';

export class UpdateExpensePersonDto extends PartialType(CreateExpensePersonDto) {}
